import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./content/**/*.{mdx,md}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      typography: {
        DEFAULT: {
          css: {
            "--tw-prose-body": "hsl(var(--muted-foreground))",
            "--tw-prose-headings": "hsl(var(--foreground))",
            "--tw-prose-lead": "hsl(var(--muted-foreground))",
            "--tw-prose-links": "hsl(var(--primary))",
            "--tw-prose-bold": "hsl(var(--foreground))",
            "--tw-prose-counters": "hsl(var(--muted-foreground))",
            "--tw-prose-bullets": "hsl(var(--muted-foreground))",
            "--tw-prose-hr": "hsl(var(--border))",
            "--tw-prose-quotes": "hsl(var(--muted-foreground))",
            "--tw-prose-quote-borders": "hsl(var(--border))",
            "--tw-prose-captions": "hsl(var(--muted-foreground))",
            "--tw-prose-code": "hsl(var(--foreground))",
            "--tw-prose-pre-code": "hsl(var(--foreground))",
            "--tw-prose-pre-bg": "hsl(var(--muted))",
            "--tw-prose-th-borders": "hsl(var(--border))",
            "--tw-prose-td-borders": "hsl(var(--border))",
            maxWidth: "none",
            color: "var(--tw-prose-body)",
            fontSize: "0.875rem",
            lineHeight: "1.5rem",
            h1: {
              fontSize: "2.25rem",
              lineHeight: "2.5rem",
              fontWeight: "700",
              marginTop: "0",
              marginBottom: "1rem",
              color: "hsl(var(--foreground))",
            },
            "h1:not(:first-child)": {
              marginTop: "2rem",
            },
            h2: {
              fontSize: "1.875rem",
              fontWeight: "700",
              marginTop: "1.5rem",
              marginBottom: "0.75rem",
              scrollMarginTop: "5rem",
              color: "hsl(var(--foreground))",
            },
            h3: {
              fontSize: "1.5rem",
              fontWeight: "600",
              marginTop: "1rem",
              marginBottom: "0.5rem",
              scrollMarginTop: "5rem",
              color: "hsl(var(--foreground))",
            },
            h4: {
              fontWeight: "600",
              color: "hsl(var(--foreground))",
            },
            p: {
              marginBottom: "1rem",
              fontSize: "0.875rem",
              lineHeight: "1.5rem",
              color: "var(--tw-prose-body)",
            },
            code: {
              backgroundColor: "hsl(var(--muted))",
              paddingLeft: "0.375rem",
              paddingRight: "0.375rem",
              paddingTop: "0.125rem",
              paddingBottom: "0.125rem",
              borderRadius: "0.25rem",
              fontSize: "0.875rem",
            },
            pre: {
              backgroundColor: "hsl(var(--muted))",
              padding: "1rem",
              borderRadius: "0.5rem",
              overflowX: "auto",
              marginBottom: "1rem",
            },
            "pre code": {
              backgroundColor: "transparent",
              padding: "0",
            },
            a: {
              color: "hsl(var(--primary))",
              textDecoration: "none",
            },
            "p a": {
              textDecoration: "underline",
              "&:hover": {
                textDecoration: "underline",
              },
            },
            "li a": {
              textDecoration: "underline",
              "&:hover": {
                textDecoration: "underline",
              },
            },
            ul: {
              listStyleType: "disc",
              listStylePosition: "inside",
              marginBottom: "1rem",
              fontSize: "0.875rem",
              lineHeight: "1.5rem",
              color: "var(--tw-prose-body)",
            },
            ol: {
              listStyleType: "decimal",
              listStylePosition: "inside",
              marginBottom: "1rem",
              fontSize: "0.875rem",
              lineHeight: "1.5rem",
              color: "var(--tw-prose-body)",
            },
            li: {
              marginBottom: "0.5rem",
              fontSize: "0.875rem",
              lineHeight: "1.5rem",
              color: "var(--tw-prose-body)",
            },
            "li::marker": {
              color: "var(--tw-prose-counters)",
            },
            "ol > li::marker": {
              color: "var(--tw-prose-counters)",
            },
            strong: {
              color: "hsl(var(--foreground))",
              fontWeight: "600",
            },
            em: {
              color: "hsl(var(--muted-foreground))",
            },
            blockquote: {
              color: "hsl(var(--foreground))",
              borderLeftColor: "hsl(var(--border))",
            },
            hr: {
              borderColor: "hsl(var(--border))",
            },
            table: {
              borderColor: "hsl(var(--border))",
            },
            thead: {
              borderBottomColor: "hsl(var(--border))",
            },
            "thead th": {
              color: "hsl(var(--foreground))",
              borderColor: "hsl(var(--border))",
            },
            "tbody tr": {
              borderBottomColor: "hsl(var(--border))",
            },
            "tbody td": {
              color: "hsl(var(--muted-foreground))",
              borderColor: "hsl(var(--border))",
            },
          },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
