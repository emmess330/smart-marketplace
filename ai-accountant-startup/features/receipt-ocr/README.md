# Receipt OCR Feature

An AI-powered receipt processing system that extracts structured data from receipt images.

## Features

- 📸 **Image Enhancement** - Auto-rotate, denoise, and optimize images for OCR
- 🔍 **OCR Text Extraction** - 99%+ accuracy using Google Cloud Vision API
- 🏷️ **Entity Extraction** - Automatic extraction of vendor, amount, date, tax
- 🎯 **Category Prediction** - ML-powered expense categorization
- 💾 **Database Integration** - Automatic saving to PostgreSQL
- 📊 **Confidence Scoring** - Quality metrics for each extraction

## Architecture

```
Receipt Image
    ↓
[Image Preprocessing]
    ├── Grayscale conversion
    ├── Adaptive thresholding
    ├── Denoising
    └── Deskewing
    ↓
[OCR (Google Vision)]
    ├── Text extraction
    └── Bounding boxes
    ↓
[Entity Extraction]
    ├── Vendor name (regex + NER)
    ├── Amount (regex patterns)
    ├── Date (date parser)
    ├── Tax (pattern matching)
    └── Payment method
    ↓
[Category Prediction]
    ├── Zero-shot classification (ML)
    └── Rule-based fallback
    ↓
[Database Storage]
    ├── documents table
    └── document_entities table
    ↓
Structured Receipt Data
```

## Installation

### 1. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 2. Download spaCy Model

```bash
python -m spacy download en_core_web_sm
```

### 3. Set up Google Cloud Vision

**Option A: Service Account (Recommended for Production)**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. Enable Vision API
4. Create Service Account
5. Download JSON credentials
6. Set environment variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
```

**Option B: Application Default Credentials (Development)**

```bash
gcloud auth application-default login
```

### 4. Configure Database (Optional)

```bash
# .env file
DATABASE_URL=postgresql://user:password@localhost:5432/accountantai
```

## Quick Start

### Basic Usage

```python
from receipt_processor import ReceiptProcessor

# Initialize processor
processor = ReceiptProcessor(
    google_credentials_path="google-credentials.json"
)

# Process a receipt
result = processor.process_receipt(
    image_path="receipt.jpg",
    client_id="client-uuid",
    user_id="user-uuid"
)

# Access extracted data
print(f"Vendor: {result.vendor_name}")
print(f"Amount: ${result.amount}")
print(f"Date: {result.date}")
print(f"Category: {result.category}")
print(f"Confidence: {result.confidence_score:.2%}")
```

### With Database Integration

```python
processor = ReceiptProcessor(
    google_credentials_path="google-credentials.json",
    db_connection_string="postgresql://user:pass@localhost/accountantai"
)

result = processor.process_receipt(
    image_path="receipt.jpg",
    client_id="client-uuid",
    user_id="user-uuid"
)
# Automatically saved to database
```

## API Integration

### FastAPI Endpoint

```python
from fastapi import FastAPI, File, UploadFile, Form
from receipt_processor import ReceiptProcessor
import shutil
import uuid

app = FastAPI()
processor = ReceiptProcessor(google_credentials_path="credentials.json")

@app.post("/api/receipts/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    client_id: str = Form(...),
    user_id: str = Form(...)
):
    """Upload and process receipt"""
    
    # Save uploaded file
    file_id = str(uuid.uuid4())
    file_path = f"/tmp/receipts/{file_id}_{file.filename}"
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        # Process receipt
        result = processor.process_receipt(
            image_path=file_path,
            client_id=client_id,
            user_id=user_id
        )
        
        return {
            "success": True,
            "data": {
                "vendor": result.vendor_name,
                "amount": float(result.amount) if result.amount else None,
                "date": result.date.isoformat() if result.date else None,
                "category": result.category,
                "confidence": result.confidence_score
            }
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
    finally:
        # Clean up
        import os
        if os.path.exists(file_path):
            os.remove(file_path)
```

### Flask Endpoint

```python
from flask import Flask, request, jsonify
from receipt_processor import ReceiptProcessor
import os

app = Flask(__name__)
processor = ReceiptProcessor(google_credentials_path="credentials.json")

@app.route('/api/receipts/upload', methods=['POST'])
def upload_receipt():
    """Upload and process receipt"""
    
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files['file']
    client_id = request.form.get('client_id')
    user_id = request.form.get('user_id')
    
    # Save temporarily
    file_path = f"/tmp/{file.filename}"
    file.save(file_path)
    
    try:
        result = processor.process_receipt(file_path, client_id, user_id)
        
        return jsonify({
            "vendor": result.vendor_name,
            "amount": float(result.amount) if result.amount else None,
            "date": result.date.isoformat() if result.date else None,
            "category": result.category,
            "confidence": result.confidence_score
        })
    finally:
        os.remove(file_path)

if __name__ == '__main__':
    app.run(debug=True)
```

## Command Line Usage

```python
# cli.py
import sys
from receipt_processor import ReceiptProcessor

def main():
    if len(sys.argv) < 2:
        print("Usage: python cli.py <receipt_image.jpg>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    processor = ReceiptProcessor()
    result = processor.process_receipt(
        image_path=image_path,
        client_id="test-client",
        user_id="test-user"
    )
    
    print(f"\n{'='*50}")
    print("RECEIPT PROCESSING RESULTS")
    print(f"{'='*50}")
    print(f"Vendor:     {result.vendor_name or 'N/A'}")
    print(f"Amount:     ${result.amount or 'N/A'}")
    print(f"Tax:        ${result.tax_amount or 'N/A'}")
    print(f"Date:       {result.date or 'N/A'}")
    print(f"Category:   {result.category or 'N/A'}")
    print(f"Payment:    {result.payment_method or 'N/A'}")
    print(f"Confidence: {result.confidence_score:.1%}")
    print(f"{'='*50}\n")

if __name__ == "__main__":
    main()
```

Run with:
```bash
python cli.py receipt.jpg
```

## Testing

### Unit Tests

```python
# test_receipt_processor.py
import pytest
from receipt_processor import (
    ReceiptProcessor, 
    ImagePreprocessor,
    ReceiptEntityExtractor
)

def test_image_enhancement():
    """Test image preprocessing"""
    preprocessor = ImagePreprocessor()
    enhanced = preprocessor.enhance_image("test_receipt.jpg")
    assert enhanced is not None
    assert enhanced.shape[2] == 1  # Grayscale

def test_amount_extraction():
    """Test amount extraction"""
    extractor = ReceiptEntityExtractor()
    
    text = "TOTAL: $42.99"
    amount = extractor.extract_amount(text)
    assert amount == 42.99
    
    text = "Total Due: 123.45"
    amount = extractor.extract_amount(text)
    assert amount == 123.45

def test_vendor_extraction():
    """Test vendor name extraction"""
    extractor = ReceiptEntityExtractor()
    
    text = "STARBUCKS COFFEE\n123 Main St\n01/15/2026"
    vendor = extractor.extract_vendor(text, [])
    assert vendor == "STARBUCKS COFFEE"

def test_date_extraction():
    """Test date extraction"""
    extractor = ReceiptEntityExtractor()
    
    text = "Date: 01/15/2026"
    date = extractor.extract_date(text)
    assert date.year == 2026
    assert date.month == 1
    assert date.day == 15

@pytest.fixture
def sample_receipt():
    """Sample receipt for testing"""
    return "test_receipts/sample_receipt.jpg"

def test_full_pipeline(sample_receipt):
    """Test complete processing pipeline"""
    processor = ReceiptProcessor()
    result = processor.process_receipt(
        sample_receipt, 
        "test-client", 
        "test-user"
    )
    
    assert result.vendor_name is not None
    assert result.amount is not None
    assert result.confidence_score > 0.5
```

Run tests:
```bash
pytest test_receipt_processor.py -v
```

### Integration Tests

```python
# test_integration.py
import os
from receipt_processor import ReceiptProcessor

def test_real_receipts():
    """Test with real receipt images"""
    processor = ReceiptProcessor()
    
    # Test directory of receipts
    test_dir = "test_receipts"
    results = []
    
    for filename in os.listdir(test_dir):
        if filename.endswith(('.jpg', '.jpeg', '.png')):
            path = os.path.join(test_dir, filename)
            
            try:
                result = processor.process_receipt(path, "test", "test")
                results.append({
                    "file": filename,
                    "success": True,
                    "vendor": result.vendor_name,
                    "amount": result.amount,
                    "confidence": result.confidence_score
                })
            except Exception as e:
                results.append({
                    "file": filename,
                    "success": False,
                    "error": str(e)
                })
    
    # Print results
    for r in results:
        print(f"{r['file']}: {r}")
    
    # Assert at least 80% success rate
    success_rate = sum(1 for r in results if r['success']) / len(results)
    assert success_rate >= 0.8
```

## Performance Optimization

### Batch Processing

```python
from concurrent.futures import ThreadPoolExecutor
import os

def process_receipt_batch(receipt_dir: str, max_workers: int = 4):
    """Process multiple receipts in parallel"""
    processor = ReceiptProcessor()
    
    receipt_files = [
        os.path.join(receipt_dir, f) 
        for f in os.listdir(receipt_dir)
        if f.endswith(('.jpg', '.jpeg', '.png'))
    ]
    
    def process_one(file_path):
        try:
            return processor.process_receipt(file_path, "client", "user")
        except Exception as e:
            return {"error": str(e), "file": file_path}
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(process_one, receipt_files))
    
    return results

# Usage
results = process_receipt_batch("receipts/", max_workers=8)
print(f"Processed {len(results)} receipts")
```

### Caching OCR Results

```python
import hashlib
import json
import os

class CachedReceiptProcessor(ReceiptProcessor):
    """Receipt processor with OCR result caching"""
    
    def __init__(self, cache_dir="/tmp/ocr_cache", **kwargs):
        super().__init__(**kwargs)
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
    
    def _get_cache_key(self, image_path: str) -> str:
        """Generate cache key from image hash"""
        with open(image_path, 'rb') as f:
            file_hash = hashlib.md5(f.read()).hexdigest()
        return f"{file_hash}.json"
    
    def process_receipt(self, image_path: str, client_id: str, user_id: str):
        """Process receipt with caching"""
        cache_key = self._get_cache_key(image_path)
        cache_path = os.path.join(self.cache_dir, cache_key)
        
        # Check cache
        if os.path.exists(cache_path):
            with open(cache_path, 'r') as f:
                cached_data = json.load(f)
                logger.info(f"Cache hit for {image_path}")
                return ReceiptData(**cached_data)
        
        # Process normally
        result = super().process_receipt(image_path, client_id, user_id)
        
        # Save to cache
        with open(cache_path, 'w') as f:
            json.dump(asdict(result), f, default=str)
        
        return result
```

## Accuracy Improvement

### Custom Model Training

```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from transformers import Trainer, TrainingArguments
import torch

def train_category_classifier(training_data):
    """Train custom category classifier on your data"""
    
    # Load pre-trained model
    model = AutoModelForSequenceClassification.from_pretrained(
        "distilbert-base-uncased",
        num_labels=len(CATEGORIES)
    )
    tokenizer = AutoTokenizer.from_pretrained("distilbert-base-uncased")
    
    # Prepare dataset
    def tokenize(batch):
        return tokenizer(batch['text'], padding=True, truncation=True)
    
    train_dataset = training_data.map(tokenize, batched=True)
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir="./models/category-classifier",
        num_train_epochs=3,
        per_device_train_batch_size=16,
        warmup_steps=500,
        weight_decay=0.01,
        logging_dir='./logs',
    )
    
    # Train
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset
    )
    
    trainer.train()
    model.save_pretrained("./models/category-classifier")
```

### User Feedback Loop

```python
def save_correction(
    document_id: str, 
    corrected_category: str,
    user_id: str
):
    """Save user correction for model retraining"""
    conn = psycopg2.connect(DB_CONNECTION_STRING)
    cursor = conn.cursor()
    
    # Get original prediction
    cursor.execute("""
        SELECT extracted_data 
        FROM documents 
        WHERE id = %s
    """, (document_id,))
    
    data = cursor.fetchone()[0]
    original_category = data['category']
    
    # Save correction to training data
    cursor.execute("""
        INSERT INTO ai_training_data (
            client_id, description, predicted_category, 
            actual_category, was_prediction_correct, feedback_by
        ) VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        data['client_id'],
        data['vendor_name'],
        original_category,
        corrected_category,
        original_category == corrected_category,
        user_id
    ))
    
    conn.commit()
    cursor.close()
    conn.close()
```

## Troubleshooting

### Common Issues

**1. Google Vision API Errors**

```python
# Error: "PERMISSION_DENIED: The caller does not have permission"
# Solution: Check your service account has Vision API access

# Error: "RESOURCE_EXHAUSTED: Quota exceeded"
# Solution: Enable billing or use caching
```

**2. Low OCR Accuracy**

```python
# Try enhancing image preprocessing:
preprocessor = ImagePreprocessor()
enhanced = preprocessor.enhance_image(image_path)
enhanced = preprocessor.resize_for_ocr(enhanced, max_width=3000)  # Higher res
```

**3. Wrong Category Predictions**

```python
# Add custom rules in CategoryPredictor.predict_with_rules()
# Or train custom model with your historical data
```

## Production Deployment

### Docker Container

```dockerfile
# Dockerfile
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy model
RUN python -m spacy download en_core_web_sm

# Copy code
COPY . .

# Run
CMD ["python", "api.py"]
```

Build and run:
```bash
docker build -t receipt-ocr .
docker run -p 8000:8000 -v $(pwd)/credentials.json:/app/credentials.json receipt-ocr
```

### Environment Variables

```bash
# .env
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://localhost:6379
AWS_S3_BUCKET=accountantai-receipts
LOG_LEVEL=INFO
```

### Monitoring

```python
import time
from prometheus_client import Counter, Histogram

# Metrics
RECEIPTS_PROCESSED = Counter('receipts_processed_total', 'Total receipts processed')
PROCESSING_TIME = Histogram('receipt_processing_seconds', 'Time to process receipt')
EXTRACTION_CONFIDENCE = Histogram('extraction_confidence', 'Confidence scores')

def process_receipt_with_metrics(self, *args, **kwargs):
    """Process receipt with monitoring"""
    start = time.time()
    
    try:
        result = self.process_receipt(*args, **kwargs)
        RECEIPTS_PROCESSED.inc()
        EXTRACTION_CONFIDENCE.observe(result.confidence_score)
        return result
    finally:
        duration = time.time() - start
        PROCESSING_TIME.observe(duration)
```

## Roadmap

- [ ] Support for invoice processing (multi-page PDFs)
- [ ] Mobile app integration (React Native / Flutter)
- [ ] Real-time processing (WebSocket updates)
- [ ] Multi-language support (Spanish, French, etc.)
- [ ] Handwritten receipt support
- [ ] Duplicate detection
- [ ] Receipt splitting (itemized expenses)

## License

MIT License - Use freely in your startup!

## Support

For issues or questions, create an issue in the repository.
