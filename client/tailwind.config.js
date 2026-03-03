/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
    	extend: {
    		fontFamily: {
    			display: [
    				'Syne',
    				'Space Grotesk',
    				'system-ui',
    				'sans-serif'
    			],
    			sans: [
    				'DM Sans',
    				'system-ui',
    				'-apple-system',
    				'sans-serif'
    			],
    			mono: [
    				'JetBrains Mono',
    				'IBM Plex Mono',
    				'monospace'
    			]
    		},
    		fontSize: {
    			display: [
    				'32px',
    				{
    					lineHeight: '1.2',
    					fontWeight: '700'
    				}
    			],
    			h1: [
    				'24px',
    				{
    					lineHeight: '1.3',
    					fontWeight: '700'
    				}
    			],
    			h2: [
    				'18px',
    				{
    					lineHeight: '1.4',
    					fontWeight: '700'
    				}
    			],
    			h3: [
    				'16px',
    				{
    					lineHeight: '1.5',
    					fontWeight: '600'
    				}
    			],
    			body: [
    				'15px',
    				{
    					lineHeight: '1.7',
    					fontWeight: '400'
    				}
    			],
    			'body-sm': [
    				'13px',
    				{
    					lineHeight: '1.6',
    					fontWeight: '400'
    				}
    			],
    			caption: [
    				'11px',
    				{
    					lineHeight: '1.5',
    					fontWeight: '500'
    				}
    			],
    			label: [
    				'10px',
    				{
    					lineHeight: '1.4',
    					fontWeight: '700',
    					letterSpacing: '0.1em',
    					textTransform: 'uppercase'
    				}
    			],
    			code: [
    				'13px',
    				{
    					lineHeight: '1.6',
    					fontWeight: '400'
    				}
    			],
    			'code-sm': [
    				'10px',
    				{
    					lineHeight: '1.5',
    					fontWeight: '400'
    				}
    			]
    		},
    		colors: {
    			/* Existing brutalist color tokens */
    			'bg-primary': '#0D1117',
    			'bg-secondary': '#151b24',
    			'bg-tertiary': '#1a2332',
    			surface: '#151b24',
    			'surface-hover': '#1a2332',
    			'surface-active': '#1f2937',
    			'border-default': '#2d3748',
    			'border-hover': '#3f4f63',
    			'border-focus': '#06b6d4',
    			'text-primary': '#e2e8f0',
    			'text-secondary': '#94a3b8',
    			'text-tertiary': '#64748b',
    			'text-muted': '#475569',
    			'accent-primary': '#ff6b35',
    			'accent-secondary': '#06b6d4',
    			'accent-tertiary': '#10b981',
    			'data-viz-1': '#06b6d4',
    			'data-viz-2': '#ff6b35',
    			'data-viz-3': '#10b981',
    			'data-viz-4': '#8b5cf6',
    			'data-viz-5': '#f59e0b',
    			/* shadcn / Lovable HSL tokens */
    			background: 'hsl(var(--background))',
    			foreground: 'hsl(var(--foreground))',
    			card: {
    				DEFAULT: 'hsl(var(--card))',
    				foreground: 'hsl(var(--card-foreground))'
    			},
    			popover: {
    				DEFAULT: 'hsl(var(--popover))',
    				foreground: 'hsl(var(--popover-foreground))'
    			},
    			primary: {
    				DEFAULT: 'hsl(var(--primary))',
    				foreground: 'hsl(var(--primary-foreground))'
    			},
    			secondary: {
    				DEFAULT: 'hsl(var(--secondary))',
    				foreground: 'hsl(var(--secondary-foreground))'
    			},
    			muted: {
    				DEFAULT: 'hsl(var(--muted))',
    				foreground: 'hsl(var(--muted-foreground))'
    			},
    			accent: {
    				DEFAULT: 'hsl(var(--accent))',
    				foreground: 'hsl(var(--accent-foreground))'
    			},
    			destructive: {
    				DEFAULT: 'hsl(var(--destructive))',
    				foreground: 'hsl(var(--destructive-foreground))'
    			},
    			success: {
    				DEFAULT: 'hsl(var(--success))',
    				foreground: 'hsl(var(--success-foreground))'
    			},
    			warning: {
    				DEFAULT: 'hsl(var(--warning))',
    				foreground: 'hsl(var(--warning-foreground))'
    			},
    			border: 'hsl(var(--border))',
    			input: 'hsl(var(--input))',
    			ring: 'hsl(var(--ring))',
    			sidebar: {
    				DEFAULT: 'hsl(var(--sidebar-background))',
    				foreground: 'hsl(var(--sidebar-foreground))',
    				primary: 'hsl(var(--sidebar-primary))',
    				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
    				accent: 'hsl(var(--sidebar-accent))',
    				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
    				border: 'hsl(var(--sidebar-border))',
    				ring: 'hsl(var(--sidebar-ring))',
    			},
    			chart: {
    				'1': 'hsl(var(--chart-1))',
    				'2': 'hsl(var(--chart-2))',
    				'3': 'hsl(var(--chart-3))',
    				'4': 'hsl(var(--chart-4))',
    				'5': 'hsl(var(--chart-5))'
    			}
    		},
    		spacing: {
    			xs: '4px',
    			sm: '8px',
    			md: '16px',
    			lg: '24px',
    			xl: '32px',
    			'2xl': '48px',
    			'3xl': '64px'
    		},
    		borderRadius: {
    			none: '0px',
    			sm: 'calc(var(--radius) - 4px)',
    			md: 'calc(var(--radius) - 2px)',
    			lg: 'var(--radius)',
    			xl: 'calc(var(--radius) + 4px)',
    			'2xl': 'calc(var(--radius) + 8px)',
    			full: '9999px'
    		},
    		boxShadow: {
    			sm: '2px 2px 0 rgba(0, 0, 0, 0.5)',
    			md: '4px 4px 0 rgba(0, 0, 0, 0.5)',
    			lg: '6px 6px 0 rgba(0, 0, 0, 0.5)',
    			glow: '0 0 0 2px currentColor',
    			'glow-cyan': '0 0 0 2px #06b6d4',
    			'glow-orange': '0 0 0 2px #ff6b35'
    		},
    		transitionDuration: {
    			fast: '150ms',
    			base: '200ms',
    			slow: '300ms',
    			slower: '500ms'
    		},
    		transitionTimingFunction: {
    			'ease-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
    			'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
    			'ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
    			sharp: 'cubic-bezier(0.4, 0, 0.6, 1)'
    		},
    		letterSpacing: {
    			label: '0.1em'
    		},
    		keyframes: {
    			'accordion-down': {
    				from: { height: '0', opacity: '0' },
    				to: { height: 'var(--radix-accordion-content-height)', opacity: '1' },
    			},
    			'accordion-up': {
    				from: { height: 'var(--radix-accordion-content-height)', opacity: '1' },
    				to: { height: '0', opacity: '0' },
    			},
    			'atlas-fade-in': {
    				'0%': { opacity: '0', transform: 'translateY(10px)' },
    				'100%': { opacity: '1', transform: 'translateY(0)' },
    			},
    			'atlas-scale-in': {
    				'0%': { transform: 'scale(0.95)', opacity: '0' },
    				'100%': { transform: 'scale(1)', opacity: '1' },
    			},
    			'atlas-slide-in-right': {
    				'0%': { transform: 'translateX(100%)' },
    				'100%': { transform: 'translateX(0)' },
    			},
    			'atlas-slide-in-left': {
				'0%': { transform: 'translateX(-100%)' },
				'100%': { transform: 'translateX(0)' },
			},
			'atlas-pulse-dot': {
				'0%, 100%': { opacity: '1' },
				'50%': { opacity: '0.5' },
			},
		},
    		animation: {
    			'accordion-down': 'accordion-down 0.2s ease-out',
    			'accordion-up': 'accordion-up 0.2s ease-out',
    			'atlas-fade-in': 'atlas-fade-in 0.4s ease-out',
    			'atlas-scale-in': 'atlas-scale-in 0.2s ease-out',
    			'atlas-slide-in-right': 'atlas-slide-in-right 0.3s ease-out',
			'atlas-slide-in-left': 'atlas-slide-in-left 0.3s ease-out',
			'atlas-pulse-dot': 'atlas-pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
		},
    	}
    },
    plugins: [require("tailwindcss-animate")],
}
