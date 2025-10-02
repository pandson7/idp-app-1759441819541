import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const textractClient = new TextractClient({});
const dynamoClient = new DynamoDBClient({});

const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: any) => {
  try {
    const { documentId, s3Key } = event;
    const [bucketName, ...keyParts] = s3Key.split('/');
    const objectKey = keyParts.join('/');

    console.log(`Processing OCR for document ${documentId}, S3 key: ${s3Key}`);

    // Extract text using Textract
    const textractResult = await textractClient.send(new DetectDocumentTextCommand({
      Document: {
        S3Object: {
          Bucket: process.env.BUCKET_NAME!,
          Name: objectKey,
        },
      },
    }));

    // Extract text from blocks
    const extractedText = textractResult.Blocks
      ?.filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .join('\n') || '';

    // Calculate confidence score
    const confidenceScores = textractResult.Blocks
      ?.filter(block => block.BlockType === 'LINE' && block.Confidence)
      .map(block => block.Confidence!) || [];
    
    const averageConfidence = confidenceScores.length > 0 
      ? confidenceScores.reduce((sum, conf) => sum + conf, 0) / confidenceScores.length 
      : 0;

    const ocrResult = {
      extractedText,
      confidence: averageConfidence,
      timestamp: new Date().toISOString(),
    };

    // Update DynamoDB with OCR results
    await dynamoClient.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        documentId: { S: documentId },
      },
      UpdateExpression: 'SET ocrResult = :ocrResult, currentStep = :currentStep',
      ExpressionAttributeValues: {
        ':ocrResult': {
          M: {
            extractedText: { S: ocrResult.extractedText },
            confidence: { N: ocrResult.confidence.toString() },
            timestamp: { S: ocrResult.timestamp },
          },
        },
        ':currentStep': { S: 'classification' },
      },
    }));

    console.log(`OCR processing completed for document ${documentId}`);

    return {
      statusCode: 200,
      documentId,
      ocrResult,
      nextStep: 'classification',
    };
  } catch (error) {
    console.error('OCR processing error:', error);

    // Update DynamoDB with error
    if (event.documentId) {
      await dynamoClient.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          documentId: { S: event.documentId },
        },
        UpdateExpression: 'SET #status = :status, errors = list_append(if_not_exists(errors, :empty_list), :error)',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': { S: 'failed' },
          ':empty_list': { L: [] },
          ':error': { L: [{ S: `OCR Error: ${error}` }] },
        },
      }));
    }

    throw error;
  }
};
