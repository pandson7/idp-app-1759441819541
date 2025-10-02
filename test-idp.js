const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Configure AWS
AWS.config.update({ region: 'us-east-1' });

const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB();
const textract = new AWS.Textract();
const bedrock = new AWS.BedrockRuntime();

const BUCKET_NAME = 'idp-documents-1759441819541';
const TABLE_NAME = 'idp-processing-1759441819541';
const MODEL_ID = 'global.anthropic.claude-sonnet-4-20250514-v1:0';

async function processDocument(imagePath) {
  try {
    console.log('Starting IDP processing for:', imagePath);
    
    // Generate document ID
    const documentId = Date.now().toString();
    const fileName = path.basename(imagePath);
    const s3Key = `documents/${documentId}/${fileName}`;
    
    // Step 1: Upload to S3
    console.log('1. Uploading to S3...');
    const fileContent = fs.readFileSync(imagePath);
    await s3.putObject({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'image/jpeg'
    }).promise();
    
    // Create initial record in DynamoDB
    await dynamodb.putItem({
      TableName: TABLE_NAME,
      Item: {
        documentId: { S: documentId },
        fileName: { S: fileName },
        uploadTime: { S: new Date().toISOString() },
        status: { S: 'processing' },
        currentStep: { S: 'ocr' },
        s3Key: { S: s3Key }
      }
    }).promise();
    
    // Step 2: OCR with Textract
    console.log('2. Running OCR with Textract...');
    const textractResult = await textract.detectDocumentText({
      Document: {
        S3Object: {
          Bucket: BUCKET_NAME,
          Name: s3Key
        }
      }
    }).promise();
    
    const extractedText = textractResult.Blocks
      .filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .join('\n');
    
    const confidenceScores = textractResult.Blocks
      .filter(block => block.BlockType === 'LINE' && block.Confidence)
      .map(block => block.Confidence);
    
    const averageConfidence = confidenceScores.length > 0 
      ? confidenceScores.reduce((sum, conf) => sum + conf, 0) / confidenceScores.length 
      : 0;
    
    console.log('OCR Results:');
    console.log('- Extracted Text:', extractedText.substring(0, 200) + '...');
    console.log('- Confidence:', averageConfidence.toFixed(2) + '%');
    
    // Update DynamoDB with OCR results
    await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: { documentId: { S: documentId } },
      UpdateExpression: 'SET ocrResult = :ocrResult, currentStep = :currentStep',
      ExpressionAttributeValues: {
        ':ocrResult': {
          M: {
            extractedText: { S: extractedText },
            confidence: { N: averageConfidence.toString() },
            timestamp: { S: new Date().toISOString() }
          }
        },
        ':currentStep': { S: 'classification' }
      }
    }).promise();
    
    // Step 3: Classification with Bedrock
    console.log('3. Running classification with Bedrock...');
    const classificationPrompt = `Please classify the following document text into one of these categories:
- Invoice
- Receipt
- Contract
- Letter
- Report
- Form
- Other

Document text:
${extractedText.substring(0, 2000)}

Respond with only the category name and a confidence score (0-100). Format: "Category: [category], Confidence: [score]"`;

    const bedrockResponse = await bedrock.invokeModel({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: classificationPrompt
        }]
      })
    }).promise();
    
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const classificationText = responseBody.content[0].text;
    
    const categoryMatch = classificationText.match(/Category:\s*([^,]+)/i);
    const confidenceMatch = classificationText.match(/Confidence:\s*(\d+)/i);
    
    const category = categoryMatch ? categoryMatch[1].trim() : 'Other';
    const classificationConfidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;
    
    console.log('Classification Results:');
    console.log('- Category:', category);
    console.log('- Confidence:', classificationConfidence + '%');
    
    // Update DynamoDB with classification results
    await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: { documentId: { S: documentId } },
      UpdateExpression: 'SET classificationResult = :classificationResult, currentStep = :currentStep',
      ExpressionAttributeValues: {
        ':classificationResult': {
          M: {
            category: { S: category },
            confidence: { N: classificationConfidence.toString() },
            timestamp: { S: new Date().toISOString() }
          }
        },
        ':currentStep': { S: 'summarization' }
      }
    }).promise();
    
    // Step 4: Summarization with Bedrock
    console.log('4. Running summarization with Bedrock...');
    const summarizationPrompt = `Please provide a concise summary of this ${category} document and extract key points.

Document text:
${extractedText}

Please provide:
1. A brief summary (2-3 sentences)
2. Key points (3-5 bullet points)

Format your response as:
Summary: [your summary]
Key Points:
- [point 1]
- [point 2]
- [point 3]`;

    const summaryResponse = await bedrock.invokeModel({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: summarizationPrompt
        }]
      })
    }).promise();
    
    const summaryResponseBody = JSON.parse(new TextDecoder().decode(summaryResponse.body));
    const summaryText = summaryResponseBody.content[0].text;
    
    const summaryMatch = summaryText.match(/Summary:\s*([^]*?)(?=Key Points:|$)/i);
    const keyPointsMatch = summaryText.match(/Key Points:\s*([^]*)/i);
    
    const summary = summaryMatch ? summaryMatch[1].trim() : summaryText;
    const keyPointsText = keyPointsMatch ? keyPointsMatch[1].trim() : '';
    const keyPoints = keyPointsText
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(point => point.length > 0);
    
    console.log('Summarization Results:');
    console.log('- Summary:', summary);
    console.log('- Key Points:', keyPoints);
    
    // Update DynamoDB with final results
    await dynamodb.updateItem({
      TableName: TABLE_NAME,
      Key: { documentId: { S: documentId } },
      UpdateExpression: 'SET summarizationResult = :summarizationResult, #status = :status, currentStep = :currentStep',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':summarizationResult': {
          M: {
            summary: { S: summary },
            keyPoints: { L: keyPoints.map(point => ({ S: point })) },
            timestamp: { S: new Date().toISOString() }
          }
        },
        ':status': { S: 'completed' },
        ':currentStep': { S: 'completed' }
      }
    }).promise();
    
    console.log('\n✅ IDP Processing completed successfully!');
    console.log('Document ID:', documentId);
    
    return {
      documentId,
      fileName,
      extractedText,
      category,
      summary,
      keyPoints
    };
    
  } catch (error) {
    console.error('❌ Error processing document:', error);
    throw error;
  }
}

// Main execution
async function main() {
  // Check if sample image exists
  const sampleImagePath = '../../echo-architect/images';
  
  try {
    const files = fs.readdirSync(sampleImagePath);
    const imageFiles = files.filter(file => 
      file.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|tiff)$/));
    
    if (imageFiles.length === 0) {
      console.log('No image files found in images directory. Creating a test record...');
      
      // Create a test record to demonstrate the system
      const documentId = Date.now().toString();
      await dynamodb.putItem({
        TableName: TABLE_NAME,
        Item: {
          documentId: { S: documentId },
          fileName: { S: 'test-document.jpg' },
          uploadTime: { S: new Date().toISOString() },
          status: { S: 'completed' },
          currentStep: { S: 'completed' },
          s3Key: { S: 'documents/test/test-document.jpg' },
          ocrResult: {
            M: {
              extractedText: { S: 'This is a sample invoice for testing purposes. Invoice #12345. Amount: $100.00. Date: 2025-10-02.' },
              confidence: { N: '95.5' },
              timestamp: { S: new Date().toISOString() }
            }
          },
          classificationResult: {
            M: {
              category: { S: 'Invoice' },
              confidence: { N: '90' },
              timestamp: { S: new Date().toISOString() }
            }
          },
          summarizationResult: {
            M: {
              summary: { S: 'This is a sample invoice document for testing the IDP system functionality.' },
              keyPoints: { L: [
                { S: 'Invoice number: 12345' },
                { S: 'Amount: $100.00' },
                { S: 'Date: 2025-10-02' }
              ]},
              timestamp: { S: new Date().toISOString() }
            }
          }
        }
      }).promise();
      
      console.log('✅ Test record created successfully!');
      console.log('Document ID:', documentId);
      return;
    }
    
    const sampleImage = path.join(sampleImagePath, imageFiles[0]);
    console.log('Processing sample image:', sampleImage);
    
    await processDocument(sampleImage);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { processDocument };
