#!/usr/bin/env python3
"""
Command-line interface for receipt processing

Usage:
    python cli.py process <receipt_image.jpg>
    python cli.py batch <directory>
    python cli.py test
"""

import sys
import os
import argparse
from pathlib import Path
from tabulate import tabulate
from receipt_processor import ReceiptProcessor


def process_single_receipt(image_path: str, processor: ReceiptProcessor):
    """Process a single receipt and print results"""
    if not os.path.exists(image_path):
        print(f"❌ Error: File not found: {image_path}")
        sys.exit(1)
    
    print(f"\n📸 Processing receipt: {image_path}")
    print("⏳ Please wait...\n")
    
    try:
        result = processor.process_receipt(
            image_path=image_path,
            client_id="cli-test-client",
            user_id="cli-test-user"
        )
        
        # Print results in a nice table
        data = [
            ["Vendor", result.vendor_name or "Not found"],
            ["Amount", f"${result.amount}" if result.amount else "Not found"],
            ["Tax", f"${result.tax_amount}" if result.tax_amount else "Not found"],
            ["Date", result.date.strftime("%Y-%m-%d") if result.date else "Not found"],
            ["Category", result.category or "Not classified"],
            ["Payment", result.payment_method or "Unknown"],
            ["Confidence", f"{result.confidence_score:.1%}"],
        ]
        
        print("=" * 60)
        print("RECEIPT PROCESSING RESULTS".center(60))
        print("=" * 60)
        print(tabulate(data, tablefmt="simple"))
        print("=" * 60)
        
        # Show extracted text preview
        if result.raw_text:
            print("\n📄 Extracted Text (first 200 chars):")
            print("-" * 60)
            print(result.raw_text[:200] + "..." if len(result.raw_text) > 200 else result.raw_text)
            print("-" * 60)
        
        # Show entities
        if result.entities:
            print(f"\n🏷️  Extracted {len(result.entities)} entities:")
            entity_data = [
                [e.entity_type.title(), e.value, f"{e.confidence:.1%}"]
                for e in result.entities
            ]
            print(tabulate(entity_data, headers=["Type", "Value", "Confidence"], tablefmt="simple"))
        
        print("\n✅ Processing complete!\n")
        
    except Exception as e:
        print(f"\n❌ Error processing receipt: {e}\n")
        sys.exit(1)


def process_batch(directory: str, processor: ReceiptProcessor):
    """Process all receipts in a directory"""
    if not os.path.isdir(directory):
        print(f"❌ Error: Directory not found: {directory}")
        sys.exit(1)
    
    # Find all image files
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp'}
    image_files = [
        os.path.join(directory, f)
        for f in os.listdir(directory)
        if Path(f).suffix.lower() in image_extensions
    ]
    
    if not image_files:
        print(f"❌ No image files found in: {directory}")
        sys.exit(1)
    
    print(f"\n📸 Found {len(image_files)} receipts to process")
    print("⏳ Processing batch...\n")
    
    results = []
    
    for i, image_path in enumerate(image_files, 1):
        print(f"[{i}/{len(image_files)}] Processing: {os.path.basename(image_path)}")
        
        try:
            result = processor.process_receipt(
                image_path=image_path,
                client_id="cli-test-client",
                user_id="cli-test-user"
            )
            
            results.append({
                "file": os.path.basename(image_path),
                "vendor": result.vendor_name or "N/A",
                "amount": f"${result.amount}" if result.amount else "N/A",
                "date": result.date.strftime("%Y-%m-%d") if result.date else "N/A",
                "category": result.category or "N/A",
                "confidence": f"{result.confidence_score:.1%}",
                "status": "✅"
            })
            
        except Exception as e:
            results.append({
                "file": os.path.basename(image_path),
                "vendor": "ERROR",
                "amount": "-",
                "date": "-",
                "category": "-",
                "confidence": "-",
                "status": f"❌ {str(e)[:30]}"
            })
    
    # Print summary table
    print("\n" + "=" * 100)
    print("BATCH PROCESSING RESULTS".center(100))
    print("=" * 100)
    
    table_data = [
        [r["file"][:30], r["vendor"][:20], r["amount"], r["date"], r["category"][:20], r["confidence"], r["status"][:30]]
        for r in results
    ]
    
    print(tabulate(
        table_data,
        headers=["File", "Vendor", "Amount", "Date", "Category", "Confidence", "Status"],
        tablefmt="grid"
    ))
    
    # Statistics
    success_count = sum(1 for r in results if r["status"] == "✅")
    success_rate = success_count / len(results) * 100
    
    print("\n📊 STATISTICS:")
    print(f"   Total: {len(results)} receipts")
    print(f"   Success: {success_count} ({success_rate:.1f}%)")
    print(f"   Failed: {len(results) - success_count}")
    print("\n✅ Batch processing complete!\n")


def run_tests():
    """Run basic tests"""
    print("\n🧪 Running tests...\n")
    
    from receipt_processor import ReceiptEntityExtractor
    
    extractor = ReceiptEntityExtractor()
    
    tests = [
        {
            "name": "Amount Extraction",
            "func": lambda: extractor.extract_amount("TOTAL: $42.99"),
            "expected": 42.99
        },
        {
            "name": "Date Extraction",
            "func": lambda: extractor.extract_date("Date: 01/15/2026") is not None,
            "expected": True
        },
        {
            "name": "Vendor Extraction",
            "func": lambda: extractor.extract_vendor("STARBUCKS\n123 Main St\n01/15/2026", []),
            "expected": "STARBUCKS"
        },
        {
            "name": "Tax Extraction",
            "func": lambda: extractor.extract_tax("Tax: $3.50"),
            "expected": 3.50
        }
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            result = test["func"]()
            if result == test["expected"]:
                print(f"✅ {test['name']}: PASSED")
                passed += 1
            else:
                print(f"❌ {test['name']}: FAILED (got {result}, expected {test['expected']})")
                failed += 1
        except Exception as e:
            print(f"❌ {test['name']}: ERROR - {e}")
            failed += 1
    
    print(f"\n📊 Test Results: {passed} passed, {failed} failed\n")
    
    if failed > 0:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Receipt OCR Command Line Interface",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Process single receipt
    python cli.py process receipt.jpg
    
    # Process all receipts in directory
    python cli.py batch ./receipts/
    
    # Run tests
    python cli.py test
    
    # With custom credentials
    python cli.py process receipt.jpg --credentials google-creds.json
        """
    )
    
    parser.add_argument(
        "command",
        choices=["process", "batch", "test"],
        help="Command to run"
    )
    
    parser.add_argument(
        "path",
        nargs="?",
        help="Path to receipt image or directory (required for process/batch)"
    )
    
    parser.add_argument(
        "--credentials",
        "-c",
        help="Path to Google Cloud credentials JSON file",
        default=None
    )
    
    parser.add_argument(
        "--db",
        help="Database connection string (optional)",
        default=None
    )
    
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Verbose output"
    )
    
    args = parser.parse_args()
    
    # Set logging level
    if args.verbose:
        import logging
        logging.basicConfig(level=logging.DEBUG)
    
    # Handle test command
    if args.command == "test":
        run_tests()
        return
    
    # Validate path argument
    if not args.path:
        print("❌ Error: path argument required for process/batch commands")
        parser.print_help()
        sys.exit(1)
    
    # Initialize processor
    print("\n🚀 Initializing Receipt Processor...")
    
    try:
        processor = ReceiptProcessor(
            google_credentials_path=args.credentials,
            db_connection_string=args.db
        )
        print("✅ Processor initialized\n")
    except Exception as e:
        print(f"❌ Error initializing processor: {e}")
        print("\nMake sure you have:")
        print("  1. Installed requirements: pip install -r requirements.txt")
        print("  2. Set up Google Cloud credentials")
        print("  3. Downloaded spaCy model: python -m spacy download en_core_web_sm\n")
        sys.exit(1)
    
    # Run command
    if args.command == "process":
        process_single_receipt(args.path, processor)
    
    elif args.command == "batch":
        process_batch(args.path, processor)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}\n")
        sys.exit(1)
