# Design Document

## Introduction

This document outlines the technical architecture for the Intelligent Document Processing (IDP) application. The system uses a serverless architecture on AWS with React frontend, Lambda functions for processing, and DynamoDB for data storage.

## System Architecture

### High-Level Architecture

The IDP application follows a serverless, event-driven architecture:

1. **Frontend**: React application hosted on S3 with CloudFront distribution
2. **API Layer**: API Gateway with Lambda functions for REST endpoints
3. **Storage**: S3 bucket for document storage
4. **Processing Pipeline**: Step Functions orchestrating Lambda functions for OCR, classification, and summarization
5. **Database**: DynamoDB for storing processing results with flexible schema
6. **AI Services**: Amazon Bedrock for document classification and summarization, Amazon Textract for OCR

### Component Details

#### Frontend Components
- **Upload Component**: Simple file upload interface
- **Results Component**: Display processing results and status
- **Status Component**: Show real-time processing progress

#### Backend Services
- **Upload API**: Handle document uploads to S3
- **Results API**: Retrieve processing results from DynamoDB
- **OCR Lambda**: Extract text using Amazon Textract
- **Classification Lambda**: Classify documents using Bedrock Claude
- **Summarization Lambda**: Generate summaries using Bedrock Claude
- **Status Lambda**: Update and retrieve processing status

#### Data Models

**Document Processing Record (DynamoDB)**
```json
{
  "documentId": "string (partition key)",
  "fileName": "string",
  "uploadTime": "string (ISO timestamp)",
  "status": "string (uploaded|processing|completed|failed)",
  "currentStep": "string (ocr|classification|summarization)",
  "s3Key": "string",
  "ocrResult": {
    "extractedText": "string",
    "confidence": "number",
    "timestamp": "string"
  },
  "classificationResult": {
    "category": "string",
    "confidence": "number",
    "timestamp": "string"
  },
  "summarizationResult": {
    "summary": "string",
    "keyPoints": ["string"],
    "timestamp": "string"
  },
  "errors": ["string"]
}
```

## Processing Flow

### Document Upload Flow
1. User selects document in React frontend
2. Frontend calls Upload API with document
3. Upload Lambda stores document in S3
4. Upload Lambda creates initial record in DynamoDB
5. Upload Lambda triggers Step Functions workflow
6. Frontend polls for status updates

### IDP Processing Flow
1. **OCR Step**: 
   - Step Functions triggers OCR Lambda
   - OCR Lambda calls Amazon Textract
   - Results stored in DynamoDB
   - Status updated to "classification"

2. **Classification Step**:
   - Step Functions triggers Classification Lambda
   - Classification Lambda calls Bedrock Claude
   - Results stored in DynamoDB
   - Status updated to "summarization"

3. **Summarization Step**:
   - Step Functions triggers Summarization Lambda
   - Summarization Lambda calls Bedrock Claude
   - Results stored in DynamoDB
   - Status updated to "completed"

### Error Handling
- Each Lambda function includes try-catch error handling
- Errors are logged to CloudWatch and stored in DynamoDB
- Step Functions includes retry logic with exponential backoff
- Frontend displays user-friendly error messages

## Security Considerations

- S3 bucket with private access, presigned URLs for uploads
- API Gateway with CORS configuration
- Lambda functions with least-privilege IAM roles
- DynamoDB with encryption at rest
- CloudFront with HTTPS enforcement

## Performance Considerations

- DynamoDB provisioned billing mode for predictable performance
- Lambda functions with appropriate memory allocation
- S3 with intelligent tiering for cost optimization
- CloudFront caching for frontend assets

## Monitoring and Logging

- CloudWatch logs for all Lambda functions
- CloudWatch metrics for API Gateway and Step Functions
- DynamoDB metrics for performance monitoring
- Custom metrics for processing pipeline success rates
