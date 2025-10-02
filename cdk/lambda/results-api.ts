import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    const documentId = event.pathParameters?.documentId;

    if (documentId) {
      // Get specific document
      const result = await dynamoClient.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          documentId: { S: documentId },
        },
      }));

      if (!result.Item) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Document not found' }),
        };
      }

      const document = unmarshall(result.Item);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(document),
      };
    } else {
      // Get all documents
      const result = await dynamoClient.send(new ScanCommand({
        TableName: TABLE_NAME,
      }));

      const documents = result.Items?.map(item => unmarshall(item)) || [];
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ documents }),
      };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
