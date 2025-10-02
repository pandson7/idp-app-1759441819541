import React, { useState, useEffect } from 'react';
import './App.css';

// Configuration - will be updated after CDK deployment
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://your-api-gateway-url';

interface ProcessingResult {
  documentId: string;
  fileName: string;
  uploadTime: string;
  status: string;
  currentStep: string;
  ocrResult?: {
    extractedText: string;
    confidence: number;
    timestamp: string;
  };
  classificationResult?: {
    category: string;
    confidence: number;
    timestamp: string;
  };
  summarizationResult?: {
    summary: string;
    keyPoints: string[];
    timestamp: string;
  };
  errors?: string[];
}

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [results, setResults] = useState<ProcessingResult | null>(null);
  const [allDocuments, setAllDocuments] = useState<ProcessingResult[]>([]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      const base64Content = await convertFileToBase64(selectedFile);
      
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileContent: base64Content,
          contentType: selectedFile.type,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setCurrentDocumentId(result.documentId);
        setSelectedFile(null);
        // Start polling for results
        pollForResults(result.documentId);
      } else {
        alert('Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const pollForResults = async (documentId: string) => {
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/results/${documentId}`);
        if (response.ok) {
          const result = await response.json();
          setResults(result);

          if (result.status === 'completed' || result.status === 'failed') {
            loadAllDocuments();
            return;
          }

          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, 5000); // Poll every 5 seconds
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    poll();
  };

  const loadAllDocuments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/results`);
      if (response.ok) {
        const data = await response.json();
        setAllDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  };

  useEffect(() => {
    loadAllDocuments();
  }, []);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Intelligent Document Processing</h1>
        
        {/* Upload Section */}
        <div className="upload-section">
          <h2>Upload Document</h2>
          <input
            type="file"
            onChange={handleFileSelect}
            accept="image/*,.pdf,.doc,.docx"
            disabled={uploading}
          />
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="upload-button"
          >
            {uploading ? 'Uploading...' : 'Upload & Process'}
          </button>
        </div>

        {/* Current Processing Status */}
        {currentDocumentId && results && (
          <div className="processing-status">
            <h2>Processing Status</h2>
            <div className="status-card">
              <p><strong>Document:</strong> {results.fileName}</p>
              <p><strong>Status:</strong> {results.status}</p>
              <p><strong>Current Step:</strong> {results.currentStep}</p>
              
              {results.status === 'processing' && (
                <div className="progress-indicator">
                  <div className="spinner"></div>
                  <p>Processing in progress...</p>
                </div>
              )}

              {results.status === 'completed' && (
                <div className="results-display">
                  <h3>Processing Results</h3>
                  
                  {results.ocrResult && (
                    <div className="result-section">
                      <h4>OCR Results</h4>
                      <p><strong>Confidence:</strong> {results.ocrResult.confidence.toFixed(2)}%</p>
                      <div className="extracted-text">
                        <strong>Extracted Text:</strong>
                        <pre>{results.ocrResult.extractedText}</pre>
                      </div>
                    </div>
                  )}

                  {results.classificationResult && (
                    <div className="result-section">
                      <h4>Classification</h4>
                      <p><strong>Category:</strong> {results.classificationResult.category}</p>
                      <p><strong>Confidence:</strong> {results.classificationResult.confidence}%</p>
                    </div>
                  )}

                  {results.summarizationResult && (
                    <div className="result-section">
                      <h4>Summary</h4>
                      <p><strong>Summary:</strong> {results.summarizationResult.summary}</p>
                      {results.summarizationResult.keyPoints.length > 0 && (
                        <div>
                          <strong>Key Points:</strong>
                          <ul>
                            {results.summarizationResult.keyPoints.map((point, index) => (
                              <li key={index}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {results.status === 'failed' && results.errors && (
                <div className="error-display">
                  <h3>Processing Errors</h3>
                  {results.errors.map((error, index) => (
                    <p key={index} className="error-message">{error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* All Documents */}
        <div className="all-documents">
          <h2>All Processed Documents</h2>
          {allDocuments.length === 0 ? (
            <p>No documents processed yet.</p>
          ) : (
            <div className="documents-list">
              {allDocuments.map((doc) => (
                <div key={doc.documentId} className="document-card">
                  <h3>{doc.fileName}</h3>
                  <p><strong>Status:</strong> {doc.status}</p>
                  <p><strong>Uploaded:</strong> {formatTimestamp(doc.uploadTime)}</p>
                  
                  {doc.status === 'completed' && (
                    <div className="document-summary">
                      {doc.classificationResult && (
                        <p><strong>Type:</strong> {doc.classificationResult.category}</p>
                      )}
                      {doc.summarizationResult && (
                        <p><strong>Summary:</strong> {doc.summarizationResult.summary.substring(0, 100)}...</p>
                      )}
                    </div>
                  )}
                  
                  <button
                    onClick={() => {
                      setCurrentDocumentId(doc.documentId);
                      setResults(doc);
                    }}
                    className="view-button"
                  >
                    View Details
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>
    </div>
  );
}

export default App;
