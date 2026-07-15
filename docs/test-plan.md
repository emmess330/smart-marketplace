# Test Plan – Smart E-commerce Marketplace

## 1. Unit Tests (Backend Services)

| Service | Endpoint / Function | Test Case | Expected Result | Status |
|---------|---------------------|-----------|-----------------|--------|
| Auth | POST /auth/register | Valid email, password, name | 201, user object, tokens | ☐ |
| Auth | POST /auth/register | Duplicate email | 409 error | ☐ |
| Auth | POST /auth/login | Correct credentials | 200, user, tokens | ☐ |
| Auth | POST /auth/login | Wrong password | 401 error | ☐ |
| Auth | GET /auth/me | Valid token | 200, user profile | ☐ |
| Auth | GET /auth/me | No token | 401 error | ☐ |
| Products | GET /products | No params | 200, product list, pagination | ☐ |
| Products | GET /products/:id | Existing product | 200, product object | ☐ |
| Products | GET /products/:id | Non-existent ID | 404 error | ☐ |
| Products | POST /products | Seller token, valid data | 201, product created | ☐ |
| Products | POST /products | Buyer token | 403 error | ☐ |
| Orders | GET /cart | Valid token | 200, cart items | ☐ |
| Orders | POST /cart | Valid product, quantity | 201, cart item | ☐ |
| Orders | POST /cart | Insufficient stock | 400 error | ☐ |
| Orders | POST /orders/checkout | Valid cart | 201, order created | ☐ |
| Orders | POST /orders/checkout | Empty cart | 400 error | ☐ |
| Orders | GET /orders | Valid token | 200, order history | ☐ |
| Search | GET /search?q=test | Valid query | 200, products, aggregations | ☐ |
| Search | GET /search/suggest?q=te | Partial query | 200, suggestions | ☐ |
| Search | POST /search/index | - | 200, indexed count | ☐ |
| Recommendations | GET /recommend/user/:id | Existing user | 200, product list | ☐ |
| Recommendations | GET /recommend/similar/:id | Existing product | 200, similar products | ☐ |
| Recommendations | GET /recommend/popular | - | 200, popular products | ☐ |
| Seller Analytics | GET /seller/analytics | Seller token | 200, overview, daily, top products | ☐ |
| Forecasting | GET /forecast/:userId | Seller user ID | 200, forecast array | ☐ |
| Stripe | POST /orders/create-payment-intent | Valid amount | 200, clientSecret | ☐ |

## 2. Integration Tests (End-to-End Flows)

| Scenario | Steps | Expected Outcome | Status |
|----------|-------|------------------|--------|
| Buyer journey | Register → Browse → View product → Add to cart → Checkout → Pay (test card) → View orders | Order created, stock reduced, order visible | ☐ |
| Seller journey | Register as seller → Create seller profile → Add product → View dashboard → See analytics and forecast | Dashboard shows sales, top products, forecast | ☐ |
| Search & filters | Search "headphones" → Filter by category → Apply price range | Results update correctly, category counts change | ☐ |
| Recommendations | Login as buyer who made purchases → Homepage shows personalised recommendations | Recommended products match purchase history | ☐ |
| Autocomplete | Type "lap" in search bar | Suggestions appear with product names and prices | ☐ |

## 3. Usability Tests (Manual)

| Task | User Action | Success Criteria | Status |
|------|-------------|------------------|--------|
| Mobile browser access | Open Chrome on Android → Visit deployed URL | Site loads and remains usable in the browser; PWA install is out of scope | ☐ |
| Mobile navigation | Tap menu icon on small screen | Mobile menu opens, links work | ☐ |
| Form validation | Register with invalid email | Error message shown | ☐ |
| Cart quantity update | Increase/decrease quantity | Cart total updates, item count changes | ☐ |
| Responsive layout | Resize browser from desktop to mobile | Layout adapts (filters stack, cards reflow) | ☐ |

## 4. Performance Tests

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| Search response time (Elasticsearch) | < 200 ms | ___ ms | ☐ |
| Product listing (PostgreSQL) | < 150 ms | ___ ms | ☐ |
| Recommendation API (Python) | < 300 ms | ___ ms | ☐ |
| Forecast API (Prophet) | < 500 ms | ___ ms | ☐ |
| Stripe payment intent | < 1 s | ___ s | ☐ |

## 5. Test Environment

- Backend: Deno services on localhost ports 8001–8005
- ML services: Python FastAPI on ports 8006–8007
- Database: PostgreSQL (Docker)
- Search: Elasticsearch (Docker)
- Frontend: Next.js on localhost:3000
- Browser: Chrome, Firefox, Safari (mobile emulation)