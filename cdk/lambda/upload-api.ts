import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const sfnClient = new SFNClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };

    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const { fileName, fileContent, contentType } = JSON.parse(event.body);
    
    if (!fileName || !fileContent) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'fileName and fileContent are required' }),
      };
    }

    const documentId = uuidv4();
    const s3Key = `documents/${documentId}/${fileName}`;
    const uploadTime = new Date().toISOString();

    // Upload file to S3
    const buffer = Buffer.from(fileContent, 'base64');
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));

    // Create initial record in DynamoDB
    await dynamoClient.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        documentId: { S: documentId },
        fileName: { S: fileName },
        uploadTime: { S: uploadTime },
        status: { S: 'uploaded' },
        currentStep: { S: 'ocr' },
        s3Key: { S: s3Key },
      },
    }));

    // Start Step Functions workflow
    await sfnClient.send(new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({
        documentId,
        s3Key,
        fileName,
      }),
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        documentId,
        message: 'Document uploaded successfully and processing started',
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
