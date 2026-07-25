# AccountantAI Landing Page

A modern, conversion-optimized landing page for an AI-powered accounting assistant startup.

## Features

- 🎨 Modern, professional design with gradient accents
- 📱 Fully responsive (mobile, tablet, desktop)
- ⚡ Fast loading with vanilla JavaScript (no frameworks)
- 🎯 Conversion-optimized layout
- 📊 Built-in analytics tracking
- ✨ Smooth animations and interactions
- 🎮 Easter egg (Konami code for fun!)

## Getting Started

### Quick Start

1. Open `index.html` in your browser
2. That's it! No build process required.

### For Development

If you want to run a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (http-server)
npx http-server -p 8000

# Using PHP
php -S localhost:8000
```

Then open http://localhost:8000 in your browser.

## Structure

```
landing-page/
├── index.html      # Main HTML file
├── styles.css      # All styles
├── script.js       # Interactive features
└── README.md       # This file
```

## Key Sections

1. **Hero** - Main value proposition with email capture
2. **Stats** - Social proof with key metrics
3. **Features** - 6 core features with details
4. **How It Works** - 3-step process
5. **Pricing** - 3 pricing tiers
6. **Testimonials** - Social proof from users
7. **Final CTA** - Bottom of funnel conversion
8. **Footer** - Links and trust signals

## Customization

### Colors

Edit the CSS variables in `styles.css`:

```css
:root {
    --primary: #4F46E5;      /* Main brand color */
    --secondary: #10B981;    /* Accent color */
    --dark: #1F2937;         /* Text color */
    /* ... more variables */
}
```

### Content

All content is in `index.html`. Key areas to customize:

- Company name in `<title>` and `.logo`
- Hero headline and subtitle
- Feature descriptions
- Pricing plans and prices
- Testimonials
- Footer links

### Analytics

Add your tracking IDs in `script.js`:

```javascript
// Replace with your Google Analytics ID
gtag('config', 'GA-XXXXXXXXX');

// Replace with your conversion tracking ID
gtag('event', 'conversion', {
    'send_to': 'AW-CONVERSION_ID'
});
```

## Email Capture

The email forms currently log to console and localStorage. To connect to your backend:

1. Open `script.js`
2. Find the `handleEmailSubmit` function
3. Replace the setTimeout with a real API call:

```javascript
fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
})
.then(response => response.json())
.then(data => {
    showToast('🎉 Success! Check your email.', 'success');
})
.catch(error => {
    showToast('Something went wrong. Try again.', 'error');
});
```

## Integrations

### Email Marketing

Connect to your email service provider:

- **Mailchimp** - Use their API to add subscribers to a list
- **ConvertKit** - Use their forms API
- **SendGrid** - Use their marketing campaigns API

### Analytics

Add tracking scripts in `<head>` of `index.html`:

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA-XXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA-XXXXXXXXX');
</script>

<!-- Facebook Pixel -->
<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'YOUR_PIXEL_ID');
  fbq('track', 'PageView');
</script>
```

## Deployment

### Netlify (Recommended)

1. Push to GitHub
2. Connect to Netlify
3. Deploy!

Or use the Netlify CLI:

```bash
npm install -g netlify-cli
netlify deploy --prod
```

### Vercel

```bash
npm install -g vercel
vercel --prod
```

### Traditional Hosting

Upload all files via FTP to your web host's public directory.

## Performance Optimization

The page is already optimized, but for production:

1. **Minify CSS/JS**
   ```bash
   # Install tools
   npm install -g clean-css-cli uglify-js
   
   # Minify
   cleancss styles.css -o styles.min.css
   uglifyjs script.js -o script.min.js
   ```

2. **Optimize images** - Use WebP format for better compression

3. **Add CDN** - Serve static assets via CloudFlare or similar

4. **Enable caching** - Add cache headers in server config

## A/B Testing Ideas

Test these elements to improve conversion:

- Hero headline variations
- CTA button text ("Start Free Trial" vs "Get Started")
- Pricing anchor (show monthly vs annual first)
- Number of testimonials
- Feature order and descriptions
- Form placement (hero only vs hero + footer)

## Browser Support

- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## License

Customize and use for your startup!

## Next Steps

1. Customize content and branding
2. Connect email capture to your backend
3. Add analytics tracking
4. Deploy to production
5. Run paid ads to drive traffic
6. A/B test and optimize conversion rate

## Questions?

This is a prototype. Customize it for your specific needs!
