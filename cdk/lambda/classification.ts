import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const bedrockClient = new BedrockRuntimeClient({});
const dynamoClient = new DynamoDBClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const MODEL_ID = 'global.anthropic.claude-sonnet-4-20250514-v1:0';

export const handler = async (event: any) => {
  try {
    const { documentId } = event;

    console.log(`Processing classification for document ${documentId}`);

    // Get document data from DynamoDB
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        documentId: { S: documentId },
      },
    }));

    if (!result.Item) {
      throw new Error(`Document ${documentId} not found`);
    }

    const document = unmarshall(result.Item);
    const extractedText = document.ocrResult?.extractedText || '';

    if (!extractedText) {
      throw new Error('No extracted text available for classification');
    }

    // Prepare prompt for classification
    const prompt = `Please classify the following document text into one of these categories:
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

    // Call Bedrock Claude model
    const bedrockResponse = await bedrockClient.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      }),
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const classificationText = responseBody.content[0].text;

    // Parse classification result
    const categoryMatch = classificationText.match(/Category:\s*([^,]+)/i);
    const confidenceMatch = classificationText.match(/Confidence:\s*(\d+)/i);

    const category = categoryMatch ? categoryMatch[1].trim() : 'Other';
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;

    const classificationResult = {
      category,
      confidence,
      timestamp: new Date().toISOString(),
    };

    // Update DynamoDB with classification results
    await dynamoClient.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        documentId: { S: documentId },
      },
      UpdateExpression: 'SET classificationResult = :classificationResult, currentStep = :currentStep',
      ExpressionAttributeValues: {
        ':classificationResult': {
          M: {
            category: { S: classificationResult.category },
            confidence: { N: classificationResult.confidence.toString() },
            timestamp: { S: classificationResult.timestamp },
          },
        },
        ':currentStep': { S: 'summarization' },
      },
    }));

    console.log(`Classification completed for document ${documentId}: ${category}`);

    return {
      statusCode: 200,
      documentId,
      classificationResult,
      nextStep: 'summarization',
    };
  } catch (error) {
    console.error('Classification error:', error);

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
          ':error': { L: [{ S: `Classification Error: ${error}` }] },
        },
      }));
    }

    throw error;
  }
};
