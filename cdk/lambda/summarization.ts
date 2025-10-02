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

    console.log(`Processing summarization for document ${documentId}`);

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
    const category = document.classificationResult?.category || 'Unknown';

    if (!extractedText) {
      throw new Error('No extracted text available for summarization');
    }

    // Prepare prompt for summarization
    const prompt = `Please provide a concise summary of this ${category} document and extract key points.

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

    // Call Bedrock Claude model
    const bedrockResponse = await bedrockClient.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      }),
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const summaryText = responseBody.content[0].text;

    // Parse summary and key points
    const summaryMatch = summaryText.match(/Summary:\s*([^]*?)(?=Key Points:|$)/i);
    const keyPointsMatch = summaryText.match(/Key Points:\s*([^]*)/i);

    const summary = summaryMatch ? summaryMatch[1].trim() : summaryText;
    const keyPointsText = keyPointsMatch ? keyPointsMatch[1].trim() : '';
    const keyPoints = keyPointsText
      .split('\n')
      .filter((line: string) => line.trim().startsWith('-'))
      .map((line: string) => line.replace(/^-\s*/, '').trim())
      .filter((point: string) => point.length > 0);

    const summarizationResult = {
      summary,
      keyPoints,
      timestamp: new Date().toISOString(),
    };

    // Update DynamoDB with summarization results and mark as completed
    await dynamoClient.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        documentId: { S: documentId },
      },
      UpdateExpression: 'SET summarizationResult = :summarizationResult, #status = :status, currentStep = :currentStep',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':summarizationResult': {
          M: {
            summary: { S: summarizationResult.summary },
            keyPoints: { L: keyPoints.map((point: string) => ({ S: point })) },
            timestamp: { S: summarizationResult.timestamp },
          },
        },
        ':status': { S: 'completed' },
        ':currentStep': { S: 'completed' },
      },
    }));

    console.log(`Summarization completed for document ${documentId}`);

    return {
      statusCode: 200,
      documentId,
      summarizationResult,
      status: 'completed',
    };
  } catch (error) {
    console.error('Summarization error:', error);

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
          ':error': { L: [{ S: `Summarization Error: ${error}` }] },
        },
      }));
    }

    throw error;
  }
};
