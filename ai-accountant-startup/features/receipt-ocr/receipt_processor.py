"""
Receipt OCR Processor for AccountantAI

This module handles receipt image processing, OCR text extraction,
and entity extraction (vendor, amount, date, category).

Features:
- Image preprocessing and enhancement
- OCR using Google Cloud Vision API
- Entity extraction using NER models
- Category prediction using ML
- Confidence scoring
"""

import os
import re
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from decimal import Decimal
import logging

# Computer Vision
from PIL import Image
import cv2
import numpy as np

# OCR
from google.cloud import vision
from google.oauth2 import service_account

# NLP and ML
import spacy
from transformers import pipeline
import torch

# Date parsing
from dateutil import parser as date_parser

# Database
import psycopg2
from psycopg2.extras import RealDictCursor


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class ExtractedEntity:
    """Represents an extracted entity from a receipt"""
    entity_type: str  # vendor, amount, date, category, tax
    value: str
    confidence: float
    bbox: Optional[Tuple[int, int, int, int]] = None  # (x, y, width, height)


@dataclass
class ReceiptData:
    """Complete extracted receipt data"""
    vendor_name: Optional[str] = None
    amount: Optional[Decimal] = None
    tax_amount: Optional[Decimal] = None
    date: Optional[datetime] = None
    category: Optional[str] = None
    payment_method: Optional[str] = None
    raw_text: Optional[str] = None
    entities: List[ExtractedEntity] = None
    confidence_score: float = 0.0


class ImagePreprocessor:
    """Preprocess receipt images for better OCR accuracy"""
    
    @staticmethod
    def enhance_image(image_path: str) -> np.ndarray:
        """
        Enhance image quality for OCR
        - Convert to grayscale
        - Increase contrast
        - Remove noise
        - Deskew if needed
        """
        # Read image
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError(f"Could not read image: {image_path}")
        
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Apply adaptive thresholding
        enhanced = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
            cv2.THRESH_BINARY, 11, 2
        )
        
        # Denoise
        denoised = cv2.fastNlMeansDenoising(enhanced, h=10)
        
        # Detect and correct skew
        deskewed = ImagePreprocessor._deskew(denoised)
        
        return deskewed
    
    @staticmethod
    def _deskew(image: np.ndarray) -> np.ndarray:
        """Detect and correct image skew"""
        coords = np.column_stack(np.where(image > 0))
        if len(coords) == 0:
            return image
            
        angle = cv2.minAreaRect(coords)[-1]
        
        # Adjust angle
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
            
        # Only correct if significant skew
        if abs(angle) < 0.5:
            return image
            
        # Rotate image
        (h, w) = image.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(
            image, M, (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE
        )
        
        return rotated
    
    @staticmethod
    def resize_for_ocr(image: np.ndarray, max_width: int = 2000) -> np.ndarray:
        """Resize image to optimal size for OCR"""
        height, width = image.shape[:2]
        
        if width > max_width:
            scale = max_width / width
            new_width = max_width
            new_height = int(height * scale)
            resized = cv2.resize(image, (new_width, new_height))
            return resized
        
        return image


class GoogleVisionOCR:
    """OCR using Google Cloud Vision API"""
    
    def __init__(self, credentials_path: Optional[str] = None):
        """Initialize Google Vision client"""
        if credentials_path:
            credentials = service_account.Credentials.from_service_account_file(
                credentials_path
            )
            self.client = vision.ImageAnnotatorClient(credentials=credentials)
        else:
            # Use default credentials from environment
            self.client = vision.ImageAnnotatorClient()
    
    def extract_text(self, image_path: str) -> Dict:
        """
        Extract text from image using Google Vision API
        Returns raw OCR results with bounding boxes
        """
        with open(image_path, 'rb') as image_file:
            content = image_file.read()
        
        image = vision.Image(content=content)
        
        # Perform text detection
        response = self.client.text_detection(image=image)
        
        if response.error.message:
            raise Exception(f"OCR Error: {response.error.message}")
        
        texts = response.text_annotations
        
        if not texts:
            return {"full_text": "", "blocks": []}
        
        # First annotation contains full text
        full_text = texts[0].description
        
        # Subsequent annotations are individual words/blocks
        blocks = []
        for text in texts[1:]:
            vertices = [(vertex.x, vertex.y) for vertex in text.bounding_poly.vertices]
            blocks.append({
                "text": text.description,
                "bbox": vertices,
                "confidence": 1.0  # Google doesn't provide confidence per word
            })
        
        return {
            "full_text": full_text,
            "blocks": blocks
        }


class ReceiptEntityExtractor:
    """Extract structured entities from receipt text"""
    
    def __init__(self):
        """Initialize NER model and regex patterns"""
        # Load spaCy model for general NER
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except:
            logger.warning("spaCy model not found. Download with: python -m spacy download en_core_web_sm")
            self.nlp = None
        
        # Regex patterns for common receipt fields
        self.patterns = {
            'amount': re.compile(r'\$?\s*\d+[,\.]?\d*\.?\d{2}', re.IGNORECASE),
            'date': re.compile(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'),
            'time': re.compile(r'\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b', re.IGNORECASE),
            'tax': re.compile(r'tax[:\s]*\$?\s*(\d+\.\d{2})', re.IGNORECASE),
            'total': re.compile(r'(?:total|amount)[:\s]*\$?\s*(\d+\.\d{2})', re.IGNORECASE),
        }
    
    def extract_vendor(self, text: str, blocks: List[Dict]) -> Optional[str]:
        """
        Extract vendor name (usually in first few lines or largest text)
        """
        lines = text.split('\n')
        
        # Vendor usually in first 3 lines
        for line in lines[:3]:
            line = line.strip()
            # Skip if it looks like a date or number
            if re.match(r'^\d', line):
                continue
            # Skip if too short
            if len(line) < 3:
                continue
            # Skip common receipt words
            if line.lower() in ['receipt', 'invoice', 'ticket', 'order']:
                continue
            
            return line
        
        return None
    
    def extract_amount(self, text: str) -> Optional[Decimal]:
        """Extract total amount from receipt"""
        # Look for "total" keyword first
        total_match = self.patterns['total'].search(text)
        if total_match:
            amount_str = total_match.group(1)
            return Decimal(amount_str)
        
        # Otherwise find largest amount (likely the total)
        amounts = self.patterns['amount'].findall(text)
        if not amounts:
            return None
        
        # Clean and convert to Decimal
        cleaned_amounts = []
        for amt in amounts:
            cleaned = amt.replace('$', '').replace(',', '').strip()
            try:
                cleaned_amounts.append(Decimal(cleaned))
            except:
                continue
        
        # Return largest amount
        if cleaned_amounts:
            return max(cleaned_amounts)
        
        return None
    
    def extract_tax(self, text: str) -> Optional[Decimal]:
        """Extract tax amount"""
        tax_match = self.patterns['tax'].search(text)
        if tax_match:
            return Decimal(tax_match.group(1))
        return None
    
    def extract_date(self, text: str) -> Optional[datetime]:
        """Extract transaction date"""
        date_matches = self.patterns['date'].findall(text)
        
        for date_str in date_matches:
            try:
                # Try parsing with dateutil
                date = date_parser.parse(date_str, fuzzy=True)
                
                # Sanity check: date should be in the past and not too old
                today = datetime.now()
                if date > today:
                    # If parsed as future date, might be wrong year
                    date = date.replace(year=date.year - 1)
                
                # Receipts shouldn't be more than 10 years old
                if (today - date).days > 3650:
                    continue
                
                return date
            except:
                continue
        
        return None
    
    def extract_payment_method(self, text: str) -> Optional[str]:
        """Extract payment method (cash, card, etc.)"""
        text_lower = text.lower()
        
        if 'cash' in text_lower:
            return 'cash'
        elif any(card in text_lower for card in ['visa', 'mastercard', 'amex', 'discover']):
            return 'credit_card'
        elif 'debit' in text_lower:
            return 'debit_card'
        
        return None


class CategoryPredictor:
    """Predict expense category using ML"""
    
    def __init__(self):
        """Initialize category prediction model"""
        self.categories = [
            'Meals & Entertainment',
            'Office Supplies',
            'Travel',
            'Utilities',
            'Rent & Lease',
            'Marketing & Advertising',
            'Professional Services',
            'Insurance',
            'Taxes & Licenses',
            'Other'
        ]
        
        # For MVP, use zero-shot classification
        # In production, train a custom model on your data
        try:
            self.classifier = pipeline(
                "zero-shot-classification",
                model="facebook/bart-large-mnli"
            )
        except:
            logger.warning("Could not load classification model")
            self.classifier = None
    
    def predict(self, vendor: str, amount: float, description: str = "") -> Tuple[str, float]:
        """
        Predict category based on vendor, amount, and description
        Returns (category, confidence)
        """
        if not self.classifier:
            return "Other", 0.5
        
        # Combine inputs for classification
        text = f"{vendor} {description}".strip()
        
        if not text:
            return "Other", 0.5
        
        # Classify
        result = self.classifier(text, self.categories)
        
        category = result['labels'][0]
        confidence = result['scores'][0]
        
        return category, confidence
    
    def predict_with_rules(self, vendor: str, amount: float) -> Tuple[str, float]:
        """
        Rule-based prediction (faster, works without ML)
        Use as fallback if ML model unavailable
        """
        vendor_lower = vendor.lower() if vendor else ""
        
        # Meals & Entertainment
        if any(keyword in vendor_lower for keyword in [
            'restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald',
            'pizza', 'bar', 'grill', 'diner', 'food'
        ]):
            return "Meals & Entertainment", 0.85
        
        # Office Supplies
        if any(keyword in vendor_lower for keyword in [
            'staples', 'office depot', 'amazon', 'paper', 'pen',
            'supplies', 'printer'
        ]):
            return "Office Supplies", 0.8
        
        # Travel
        if any(keyword in vendor_lower for keyword in [
            'airline', 'hotel', 'uber', 'lyft', 'taxi', 'parking',
            'rental car', 'airbnb', 'gas station', 'fuel'
        ]):
            return "Travel", 0.85
        
        # Utilities
        if any(keyword in vendor_lower for keyword in [
            'electric', 'power', 'gas company', 'water', 'internet',
            'phone', 'verizon', 'at&t', 'comcast'
        ]):
            return "Utilities", 0.9
        
        # Default to Other with lower confidence
        return "Other", 0.5


class ReceiptProcessor:
    """Main receipt processing pipeline"""
    
    def __init__(
        self, 
        google_credentials_path: Optional[str] = None,
        db_connection_string: Optional[str] = None
    ):
        """Initialize receipt processor with all components"""
        self.preprocessor = ImagePreprocessor()
        self.ocr = GoogleVisionOCR(google_credentials_path)
        self.entity_extractor = ReceiptEntityExtractor()
        self.category_predictor = CategoryPredictor()
        self.db_connection_string = db_connection_string
    
    def process_receipt(
        self, 
        image_path: str,
        client_id: str,
        user_id: str
    ) -> ReceiptData:
        """
        Complete receipt processing pipeline
        
        Args:
            image_path: Path to receipt image
            client_id: Client UUID
            user_id: User UUID who uploaded receipt
            
        Returns:
            ReceiptData with extracted information
        """
        logger.info(f"Processing receipt: {image_path}")
        
        # Step 1: Preprocess image
        enhanced_image = self.preprocessor.enhance_image(image_path)
        
        # Save enhanced image temporarily
        temp_path = image_path.replace('.', '_enhanced.')
        cv2.imwrite(temp_path, enhanced_image)
        
        # Step 2: OCR text extraction
        ocr_result = self.ocr.extract_text(temp_path)
        raw_text = ocr_result['full_text']
        blocks = ocr_result['blocks']
        
        logger.info(f"Extracted {len(raw_text)} characters of text")
        
        # Step 3: Extract entities
        vendor = self.entity_extractor.extract_vendor(raw_text, blocks)
        amount = self.entity_extractor.extract_amount(raw_text)
        tax = self.entity_extractor.extract_tax(raw_text)
        date = self.entity_extractor.extract_date(raw_text)
        payment_method = self.entity_extractor.extract_payment_method(raw_text)
        
        # Step 4: Predict category
        category, category_confidence = self.category_predictor.predict(
            vendor or "",
            float(amount) if amount else 0.0,
            raw_text[:200]  # First 200 chars
        )
        
        # Step 5: Build entity list with confidence scores
        entities = []
        
        if vendor:
            entities.append(ExtractedEntity(
                entity_type="vendor",
                value=vendor,
                confidence=0.85
            ))
        
        if amount:
            entities.append(ExtractedEntity(
                entity_type="amount",
                value=str(amount),
                confidence=0.95
            ))
        
        if date:
            entities.append(ExtractedEntity(
                entity_type="date",
                value=date.isoformat(),
                confidence=0.9
            ))
        
        if category:
            entities.append(ExtractedEntity(
                entity_type="category",
                value=category,
                confidence=category_confidence
            ))
        
        # Step 6: Calculate overall confidence score
        if entities:
            overall_confidence = sum(e.confidence for e in entities) / len(entities)
        else:
            overall_confidence = 0.0
        
        # Step 7: Build receipt data object
        receipt_data = ReceiptData(
            vendor_name=vendor,
            amount=amount,
            tax_amount=tax,
            date=date,
            category=category,
            payment_method=payment_method,
            raw_text=raw_text,
            entities=entities,
            confidence_score=overall_confidence
        )
        
        logger.info(f"Extracted: vendor={vendor}, amount={amount}, date={date}, category={category}")
        logger.info(f"Overall confidence: {overall_confidence:.2f}")
        
        # Step 8: Save to database (if connection provided)
        if self.db_connection_string:
            document_id = self._save_to_database(
                image_path, receipt_data, client_id, user_id
            )
            logger.info(f"Saved to database with document_id: {document_id}")
        
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        return receipt_data
    
    def _save_to_database(
        self, 
        image_path: str, 
        receipt_data: ReceiptData,
        client_id: str,
        user_id: str
    ) -> str:
        """Save extracted receipt data to database"""
        conn = psycopg2.connect(self.db_connection_string)
        cursor = conn.cursor()
        
        try:
            # Upload image to S3 (placeholder - implement actual S3 upload)
            file_url = f"s3://accountantai-receipts/{os.path.basename(image_path)}"
            
            # Insert document record
            cursor.execute("""
                INSERT INTO documents (
                    client_id, uploaded_by, file_name, file_url,
                    document_type, document_date, ocr_text,
                    extracted_data, ocr_confidence_score, processing_status
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                ) RETURNING id
            """, (
                client_id,
                user_id,
                os.path.basename(image_path),
                file_url,
                'receipt',
                receipt_data.date,
                receipt_data.raw_text,
                json.dumps(asdict(receipt_data), default=str),
                float(receipt_data.confidence_score),
                'completed'
            ))
            
            document_id = cursor.fetchone()[0]
            
            # Insert extracted entities
            for entity in receipt_data.entities:
                cursor.execute("""
                    INSERT INTO document_entities (
                        document_id, entity_type, entity_value, confidence_score
                    ) VALUES (%s, %s, %s, %s)
                """, (
                    document_id,
                    entity.entity_type,
                    entity.value,
                    float(entity.confidence)
                ))
            
            conn.commit()
            return str(document_id)
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {e}")
            raise
        finally:
            cursor.close()
            conn.close()


# Example usage
if __name__ == "__main__":
    # Initialize processor
    processor = ReceiptProcessor(
        google_credentials_path="path/to/google-credentials.json",
        # db_connection_string="postgresql://user:pass@localhost/accountantai"
    )
    
    # Process a receipt
    try:
        result = processor.process_receipt(
            image_path="sample_receipt.jpg",
            client_id="client-uuid-here",
            user_id="user-uuid-here"
        )
        
        print("\n=== Receipt Processing Results ===")
        print(f"Vendor: {result.vendor_name}")
        print(f"Amount: ${result.amount}")
        print(f"Date: {result.date}")
        print(f"Category: {result.category}")
        print(f"Confidence: {result.confidence_score:.2%}")
        print(f"\nExtracted {len(result.entities)} entities")
        
    except Exception as e:
        logger.error(f"Error processing receipt: {e}")
        raise
