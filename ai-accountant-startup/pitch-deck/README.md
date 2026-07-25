# AccountantAI Pitch Deck

A comprehensive investor pitch deck for raising a $2M seed round.

## Overview

This pitch deck follows the standard VC format and covers all essential elements investors expect to see.

## Contents

**20 slides covering:**
1. Cover
2. Problem
3. Market Opportunity
4. Solution
5. Product Demo
6. Business Model
7. Go-to-Market Strategy
8. Competition
9. Traction
10. Technology
11. Team
12. Financials
13. Risks & Mitigation
14. The Ask
15. Vision
16. Thank You
17. Q&A

## How to Use

### Option 1: Convert to PowerPoint/Google Slides (Recommended)

**Using Marp (Markdown to Slides)**

1. Install Marp:
   ```bash
   npm install -g @marp-team/marp-cli
   ```

2. Convert to PowerPoint:
   ```bash
   marp pitch-deck.md --pptx -o pitch-deck.pptx
   ```

3. Convert to PDF:
   ```bash
   marp pitch-deck.md --pdf -o pitch-deck.pdf
   ```

4. Generate HTML slides:
   ```bash
   marp pitch-deck.md -o pitch-deck.html
   ```

**Using reveal.js**

1. Create HTML file with reveal.js
2. Copy content sections between `---` separators
3. Wrap each in `<section>` tags

**Manual Conversion**

1. Copy content to Google Slides or PowerPoint
2. Add your branding and visuals
3. Create 16:9 slides with one concept per slide

### Option 2: Use as-is for Quick Pitch

The markdown format works well for:
- Email decks sent to investors
- Notion pages
- GitHub/docs for sharing internally
- Quick reference guide

## Customization Checklist

Before presenting, customize these sections:

### Critical (Must Change)
- [ ] Company name and logo
- [ ] Founder names and bios
- [ ] Contact information
- [ ] Actual traction metrics (users, revenue)
- [ ] Funding amount and terms
- [ ] Target close date

### Important (Should Change)
- [ ] Market size data (verify current numbers)
- [ ] Customer testimonials (use real ones)
- [ ] Team photos
- [ ] Product screenshots
- [ ] Financial projections (based on your model)
- [ ] Competitive landscape (add/remove companies)

### Nice to Have (Optional)
- [ ] Add company color scheme
- [ ] Include product demo video
- [ ] Add investor logos (if applicable)
- [ ] Include press mentions
- [ ] Add customer logos

## Design Tips

### Visual Hierarchy
1. **One message per slide** - Don't overcrowd
2. **Big, bold headlines** - Key takeaway at top
3. **Support with data** - Charts, numbers, quotes
4. **Consistent formatting** - Same fonts, colors, spacing

### Must-Have Visuals
- Company logo on every slide
- Product screenshots (mockups if not built yet)
- Charts for financial projections
- Team photos
- Customer logos (if you have them)
- Competitive landscape diagram

### Color Scheme
If you don't have brand colors yet:
- **Primary**: Choose one bold color (e.g., blue, purple, green)
- **Secondary**: Complementary accent color
- **Neutral**: Grays for text and backgrounds
- **Keep it clean**: Max 3-4 colors total

## Presentation Tips

### For In-Person Meetings (30-45 min)

**Timing Breakdown:**
- Introduction: 2 min
- Problem/Market: 3 min
- Solution/Demo: 5 min
- Business Model: 3 min
- Go-to-Market: 3 min
- Competition: 2 min
- Traction: 4 min
- Team: 2 min
- Financials: 3 min
- The Ask: 2 min
- Q&A: 10-15 min

**Best Practices:**
- Practice until you can do it without notes
- Know your numbers cold (CAC, LTV, burn, etc.)
- Prepare for common objections
- Have backup slides ready (appendix)
- Bring laptop AND USB with deck
- Test screen sharing in advance

### For Email/Digital Sharing (15-slide version)

Send a shorter version:
1. Cover
2. Problem
3. Solution
4. Market
5. Traction
6. Business Model
7. Competition
8. Team
9. Financials
10. The Ask

**Email Template:**

```
Subject: [Intro from [Mutual Connection]] - AccountantAI Seed Deck

Hi [Investor Name],

[Mutual connection] suggested I reach out. We're building AI-powered
accounting automation that saves accountants 10+ hours per week.

We have:
- 500 users in 4 months
- $78K ARR with 18% WoW growth
- 4.9/5 rating from CPAs

We're raising a $2M seed round and would love to get your thoughts.
Deck attached. Happy to jump on a call if it's interesting.

Best,
[Your Name]

P.S. Demo available at app.accountantai.com (login: demo@accountantai.com)
```

## Common Investor Questions

Be prepared to answer:

### Product
- "What happens if the AI makes a mistake?"
- "How accurate is the OCR/categorization?"
- "Why can't I just use QuickBooks + ChatGPT?"

### Market
- "How will you compete with Intuit?"
- "Is the market big enough?"
- "Why now? Why hasn't this been done before?"

### Business Model
- "What's your CAC:LTV ratio?"
- "What's the payback period?"
- "Why will customers switch from QuickBooks?"

### Traction
- "What's your retention/churn?"
- "Who are your power users?"
- "What's your growth rate?"

### Team
- "Why are you the right team?"
- "What's your background in accounting?"
- "Have you raised before?"

### Financials
- "When will you be profitable?"
- "What's your burn rate?"
- "How long will this money last?"

## Follow-up Materials

After the pitch, be ready to send:

1. **Financial Model** (Excel)
   - 5-year projections
   - Unit economics breakdown
   - Hiring plan
   - Sensitivity analysis

2. **Product Demo** (Video or live)
   - 5-minute walkthrough
   - Key features highlighted
   - Real customer data (anonymized)

3. **Data Room** (for serious investors)
   - Articles of incorporation
   - Cap table
   - Contracts (customers, vendors)
   - IP documentation
   - Financial statements
   - Security documentation

4. **References**
   - Customer testimonials
   - Advisor endorsements
   - Partner letters of intent

## Fundraising Timeline

**Typical seed round process:**

1. **Prep** (2-4 weeks)
   - Finalize deck
   - Build data room
   - Get warm intros to 30+ investors

2. **Initial meetings** (3-4 weeks)
   - 20-30 first meetings
   - Refine pitch based on feedback
   - Identify 5-10 interested investors

3. **Deep dives** (2-3 weeks)
   - Due diligence calls
   - Product demos
   - Customer reference calls
   - Financial model reviews

4. **Term sheets** (1-2 weeks)
   - Negotiate terms
   - Choose lead investor
   - Finalize deal

5. **Close** (2-4 weeks)
   - Legal documentation
   - Background checks
   - Wire transfer

**Total: 10-17 weeks (2.5-4 months)**

## Target Investor Profile

### Ideal Investors
- **Fintech-focused** VCs (e.g., Ribbit, QED, Fin Capital)
- **B2B SaaS** specialists (e.g., Point Nine, Bessemer, Battery)
- **AI-first** funds (e.g., Radical, Air Street, Foundation)

### Check Size
- **Seed stage** ($500K-$2M checks)
- **Leading or following** (need 1 lead, 2-3 followers)

### Geography
- **US-based** preferred (especially SF, NYC)
- **Remote-first** funds work too

### Value-Add
- Look for investors with:
  - Fintech portfolio (can make intros)
  - B2B SaaS expertise (help with GTM)
  - AI/ML knowledge (technical guidance)
  - CFO network (customer acquisition)

## Resources

### Deck Design Tools
- **Canva** - Easy templates, drag-and-drop
- **Pitch** - Collaborative slide builder
- **Beautiful.ai** - AI-powered design
- **Figma** - Professional design control

### Example Decks to Study
- **Airbnb** - Legendary seed deck
- **Uber** - Problem-solution-market
- **LinkedIn** - B2B SaaS model
- **Front** - Product screenshots

### Fundraising Resources
- **YC Startup School** - Free fundraising course
- **First Round Capital** - Pitch deck guide
- **DocSend** - Pitch deck analytics tool
- **Crunchbase** - Investor database

## Next Steps

1. **Customize this deck** with your data
2. **Get feedback** from advisors/friends
3. **Practice pitch** 10+ times
4. **Get warm intros** to investors
5. **Send deck** to 30+ investors
6. **Iterate based** on feedback
7. **Close the round!**

## Questions?

This is a template. Customize it for your specific business!

Good luck raising your round! 🚀
