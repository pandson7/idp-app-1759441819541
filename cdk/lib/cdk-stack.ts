import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class IdpStack1759441819541 extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const suffix = '1759441819541';

    // S3 bucket for document storage
    const documentBucket = new s3.Bucket(this, `DocumentBucket${suffix}`, {
      bucketName: `idp-documents-${suffix}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // DynamoDB table for processing results
    const processingTable = new dynamodb.Table(this, `ProcessingTable${suffix}`, {
      tableName: `idp-processing-${suffix}`,
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 5,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // IAM role for Lambda functions
    const lambdaRole = new iam.Role(this, `LambdaRole${suffix}`, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
              resources: [documentBucket.bucketArn + '/*'],
            }),
          ],
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:Scan'],
              resources: [processingTable.tableArn],
            }),
          ],
        }),
        TextractAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['textract:DetectDocumentText', 'textract:AnalyzeDocument'],
              resources: ['*'],
            }),
          ],
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock:InvokeModel'],
              resources: [
                'arn:aws:bedrock:*:*:inference-profile/global.anthropic.claude-sonnet-4-20250514-v1:0',
                'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0'
              ],
            }),
          ],
        }),
        StepFunctionsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['states:StartExecution'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Lambda functions
    const uploadLambda = new lambda.Function(this, `UploadLambda${suffix}`, {
      functionName: `idp-upload-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'upload-api.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaRole,
      environment: {
        BUCKET_NAME: documentBucket.bucketName,
        TABLE_NAME: processingTable.tableName,
        STATE_MACHINE_ARN: '', // Will be set after Step Functions creation
      },
      timeout: cdk.Duration.seconds(30),
    });

    const resultsLambda = new lambda.Function(this, `ResultsLambda${suffix}`, {
      functionName: `idp-results-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'results-api.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaRole,
      environment: {
        TABLE_NAME: processingTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
    });

    const ocrLambda = new lambda.Function(this, `OcrLambda${suffix}`, {
      functionName: `idp-ocr-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'ocr-processing.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaRole,
      environment: {
        BUCKET_NAME: documentBucket.bucketName,
        TABLE_NAME: processingTable.tableName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    const classificationLambda = new lambda.Function(this, `ClassificationLambda${suffix}`, {
      functionName: `idp-classification-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'classification.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaRole,
      environment: {
        TABLE_NAME: processingTable.tableName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    const summarizationLambda = new lambda.Function(this, `SummarizationLambda${suffix}`, {
      functionName: `idp-summarization-${suffix}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'summarization.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      role: lambdaRole,
      environment: {
        TABLE_NAME: processingTable.tableName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Step Functions workflow
    const ocrTask = new stepfunctionsTasks.LambdaInvoke(this, `OcrTask${suffix}`, {
      lambdaFunction: ocrLambda,
      outputPath: '$.Payload',
    });

    const classificationTask = new stepfunctionsTasks.LambdaInvoke(this, `ClassificationTask${suffix}`, {
      lambdaFunction: classificationLambda,
      outputPath: '$.Payload',
    });

    const summarizationTask = new stepfunctionsTasks.LambdaInvoke(this, `SummarizationTask${suffix}`, {
      lambdaFunction: summarizationLambda,
      outputPath: '$.Payload',
    });

    const definition = ocrTask
      .next(classificationTask)
      .next(summarizationTask);

    const stateMachine = new stepfunctions.StateMachine(this, `IdpStateMachine${suffix}`, {
      stateMachineName: `idp-workflow-${suffix}`,
      definition,
      timeout: cdk.Duration.minutes(15),
    });

    // Update upload Lambda with State Machine ARN
    uploadLambda.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    // Grant Step Functions execution permission to upload Lambda
    stateMachine.grantStartExecution(uploadLambda);

    // API Gateway
    const api = new apigateway.RestApi(this, `IdpApi${suffix}`, {
      restApiName: `idp-api-${suffix}`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // API endpoints
    const uploadIntegration = new apigateway.LambdaIntegration(uploadLambda);
    const resultsIntegration = new apigateway.LambdaIntegration(resultsLambda);

    api.root.addResource('upload').addMethod('POST', uploadIntegration);
    
    const resultsResource = api.root.addResource('results');
    resultsResource.addMethod('GET', resultsIntegration);
    resultsResource.addResource('{documentId}').addMethod('GET', resultsIntegration);

    // Stack outputs
    new cdk.CfnOutput(this, 'DocumentBucketName', {
      value: documentBucket.bucketName,
      description: 'S3 bucket for document storage',
    });

    new cdk.CfnOutput(this, 'ProcessingTableName', {
      value: processingTable.tableName,
      description: 'DynamoDB table for processing results',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Step Functions State Machine ARN',
    });
  }
}
