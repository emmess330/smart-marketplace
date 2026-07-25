// Email capture form handlers
document.addEventListener('DOMContentLoaded', function() {
    // Handle main hero form
    const heroForm = document.getElementById('email-form');
    if (heroForm) {
        heroForm.addEventListener('submit', handleEmailSubmit);
    }

    // Handle footer form
    const footerForm = document.getElementById('email-form-footer');
    if (footerForm) {
        footerForm.addEventListener('submit', handleEmailSubmit);
    }

    // Smooth scroll for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Navbar scroll effect
    let lastScroll = 0;
    const navbar = document.querySelector('.navbar');
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 100) {
            navbar.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
        } else {
            navbar.style.boxShadow = 'none';
        }
        
        lastScroll = currentScroll;
    });

    // Animate elements on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe all feature cards and pricing cards
    document.querySelectorAll('.feature-card, .pricing-card, .testimonial-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.6s ease-out';
        observer.observe(el);
    });

    // Counter animation for stats
    const statObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                statObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    document.querySelectorAll('.stat-value').forEach(stat => {
        statObserver.observe(stat);
    });
});

function handleEmailSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const emailInput = form.querySelector('input[type="email"]');
    const email = emailInput.value;
    
    // Basic email validation
    if (!isValidEmail(email)) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    // Show loading state
    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Submitting...';
    submitButton.disabled = true;

    // Simulate API call (replace with actual API endpoint)
    setTimeout(() => {
        // Store email (in real app, this would be an API call)
        console.log('Email submitted:', email);
        
        // Store in localStorage for demo purposes
        localStorage.setItem('user_email', email);
        
        // Show success message
        showToast('🎉 Success! Check your email for next steps.', 'success');
        
        // Reset form
        emailInput.value = '';
        submitButton.textContent = originalText;
        submitButton.disabled = false;
        
        // Track conversion (replace with actual analytics)
        if (typeof gtag !== 'undefined') {
            gtag('event', 'conversion', {
                'send_to': 'AW-CONVERSION_ID',
                'value': 1.0,
                'currency': 'USD'
            });
        }
        
        // Redirect to thank you page or onboarding (optional)
        // setTimeout(() => {
        //     window.location.href = '/onboarding';
        // }, 2000);
        
    }, 1500);
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function showToast(message, type = 'success') {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    
    if (type === 'error') {
        toast.style.background = '#EF4444';
    }
    
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 5000);
}

function animateCounter(element) {
    const text = element.textContent;
    const hasPlus = text.includes('+');
    const hasDollar = text.includes('$');
    const hasK = text.includes('K');
    const hasSec = text.includes('sec');
    const hasPercent = text.includes('%');
    
    // Extract number
    let target = parseFloat(text.replace(/[^0-9.]/g, ''));
    
    if (isNaN(target)) return;
    
    const duration = 2000;
    const steps = 60;
    const stepValue = target / steps;
    const stepDuration = duration / steps;
    
    let current = 0;
    
    const timer = setInterval(() => {
        current += stepValue;
        
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        
        let displayValue = current.toFixed(current < 10 ? 1 : 0);
        
        // Add formatting back
        if (hasDollar) displayValue = '$' + displayValue;
        if (hasK) displayValue = displayValue + 'K';
        if (hasSec) displayValue = displayValue + ' sec';
        if (hasPercent) displayValue = displayValue + '%';
        if (hasPlus) displayValue = displayValue + '+';
        
        element.textContent = displayValue;
    }, stepDuration);
}

// Pricing card interaction
document.querySelectorAll('.pricing-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-8px)';
    });
    
    card.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(-4px)';
    });
});

// Feature card interaction
document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('click', function() {
        // Add click animation
        this.style.transform = 'scale(0.98)';
        setTimeout(() => {
            this.style.transform = '';
        }, 150);
    });
});

// Track scroll depth for analytics
let scrollDepth = 0;
window.addEventListener('scroll', function() {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollPercent = (scrollTop / (documentHeight - windowHeight)) * 100;
    
    // Track 25%, 50%, 75%, 100% milestones
    if (scrollPercent >= 25 && scrollDepth < 25) {
        scrollDepth = 25;
        trackEvent('scroll_depth', { depth: '25%' });
    } else if (scrollPercent >= 50 && scrollDepth < 50) {
        scrollDepth = 50;
        trackEvent('scroll_depth', { depth: '50%' });
    } else if (scrollPercent >= 75 && scrollDepth < 75) {
        scrollDepth = 75;
        trackEvent('scroll_depth', { depth: '75%' });
    } else if (scrollPercent >= 95 && scrollDepth < 100) {
        scrollDepth = 100;
        trackEvent('scroll_depth', { depth: '100%' });
    }
});

function trackEvent(eventName, eventParams) {
    // Google Analytics 4
    if (typeof gtag !== 'undefined') {
        gtag('event', eventName, eventParams);
    }
    
    // Console log for debugging
    console.log('Event tracked:', eventName, eventParams);
}

// Add click tracking for CTA buttons
document.querySelectorAll('.btn-primary, .btn-primary-large').forEach(button => {
    button.addEventListener('click', function(e) {
        const buttonText = this.textContent.trim();
        trackEvent('cta_click', { 
            button_text: buttonText,
            location: this.closest('section')?.className || 'unknown'
        });
    });
});

// Easter egg: Konami code
let konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiIndex = 0;

document.addEventListener('keydown', function(e) {
    if (e.key === konamiCode[konamiIndex]) {
        konamiIndex++;
        if (konamiIndex === konamiCode.length) {
            activateEasterEgg();
            konamiIndex = 0;
        }
    } else {
        konamiIndex = 0;
    }
});

function activateEasterEgg() {
    showToast('🎮 Konami Code Activated! Here\'s a special 50% discount code: KONAMI2026', 'success');
    
    // Add confetti effect
    const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            createConfetti(colors[Math.floor(Math.random() * colors.length)]);
        }, i * 30);
    }
}

function createConfetti(color) {
    const confetti = document.createElement('div');
    confetti.style.position = 'fixed';
    confetti.style.width = '10px';
    confetti.style.height = '10px';
    confetti.style.background = color;
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.top = '-10px';
    confetti.style.borderRadius = '50%';
    confetti.style.zIndex = '9999';
    confetti.style.pointerEvents = 'none';
    confetti.style.transition = 'all 3s ease-out';
    
    document.body.appendChild(confetti);
    
    setTimeout(() => {
        confetti.style.top = '100vh';
        confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
        confetti.style.opacity = '0';
    }, 10);
    
    setTimeout(() => {
        confetti.remove();
    }, 3000);
}
