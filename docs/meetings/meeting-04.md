# Meeting 4 — 12 April 2026

**Attendees:** Ahmedu Bangura, Vasileios Germanos

**Progress since last meeting:**
- Completed Phase 4: Python ML recommendation engine fully implemented
- Content-based filtering built using category, tag overlap, and price 
  similarity scoring
- Collaborative filtering implemented using TruncatedSVD matrix 
  factorisation — activates automatically when sufficient interaction 
  data exists
- FastAPI microservice built and running on port 8006 with endpoints for
  user recommendations, similar products, and popular products
- Graceful fallback to popular products for new or unknown users
- Similar products section integrated into product detail page
- Personalised recommendations integrated into homepage
- Model evaluation script built with precision@k and recall@k metrics

**Discussed:**
- Content-based model working correctly — electronics products correctly 
  recommended alongside other electronics
- Collaborative model requires more user interaction data to activate —
  will improve as platform usage grows
- Next priority: seller analytics dashboard with sales forecasting (Phase 5)

**Actions before next meeting:**
- Build seller dashboard with sales analytics
- Implement Prophet-based sales forecasting model
- Begin mobile app planning (Phase 6)

**Supervisor signature:** _________________________

**Student signature:** _________________________