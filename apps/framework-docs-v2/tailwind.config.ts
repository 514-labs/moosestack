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
        text: {
          body: "hsl(var(--text-body))",
          link: "hsl(var(--text-link))",
          "link-hover": "hsl(var(--text-link-hover))",
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
            fontSize: "1.0625rem",
            color: "hsl(var(--text-body))",
            lineHeight: "1.7",
            h1: {
              fontSize: "3rem",
              lineHeight: "1.1",
              fontWeight: "700",
              marginTop: "0",
              marginBottom: "1.5rem",
            },
            h2: {
              fontSize: "2rem",
              lineHeight: "1.2",
              fontWeight: "700",
              marginTop: "2.5rem",
              marginBottom: "1rem",
              scrollMarginTop: "5rem",
            },
            h3: {
              fontSize: "1.5rem",
              lineHeight: "1.3",
              fontWeight: "600",
              marginTop: "2rem",
              marginBottom: "0.75rem",
              scrollMarginTop: "5rem",
            },
            p: {
              marginBottom: "1.25rem",
              lineHeight: "1.7",
            },
            a: {
              color: "hsl(var(--text-link))",
              textDecoration: "underline",
              textDecorationColor: "hsl(var(--text-link) / 0.3)",
              textUnderlineOffset: "2px",
              "&:hover": {
                color: "hsl(var(--text-link-hover))",
                textDecorationColor: "hsl(var(--text-link-hover))",
              },
            },
            "h1 a, h2 a, h3 a, h4 a, h5 a, h6 a": {
              textDecoration: "none",
              "&:hover": {
                textDecoration: "none",
              },
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
            strong: {
              color: "hsl(var(--foreground))",
              fontWeight: "600",
            },
            code: {
              backgroundColor: "hsl(var(--muted))",
              color: "hsl(var(--foreground))",
              paddingLeft: "0.375rem",
              paddingRight: "0.375rem",
              paddingTop: "0.25rem",
              paddingBottom: "0.25rem",
              borderRadius: "0.25rem",
              fontSize: "0.875em",
              fontWeight: "500",
              border: "1px solid hsl(var(--border))",
            },
            pre: {
              backgroundColor: "hsl(var(--muted) / 0.5)",
              padding: "1.25rem",
              borderRadius: "0.5rem",
              overflowX: "auto",
              marginTop: "1.5rem",
              marginBottom: "1.5rem",
              border: "1px solid hsl(var(--border))",
            },
            "pre code": {
              backgroundColor: "transparent",
              padding: "0",
              border: "none",
            },
            ul: {
              listStyleType: "disc",
              listStylePosition: "inside",
              marginBottom: "1rem",
            },
            ol: {
              listStyleType: "decimal",
              listStylePosition: "inside",
              marginBottom: "1rem",
            },
            li: {
              marginBottom: "0.5rem",
            },
          },
        },
        lg: {
          css: {
            fontSize: "1.125rem",
            lineHeight: "1.75",
            h1: {
              fontSize: "3rem",
              lineHeight: "1.1",
            },
            h2: {
              fontSize: "2.25rem",
              lineHeight: "1.15",
            },
            h3: {
              fontSize: "1.75rem",
              lineHeight: "1.25",
            },
          },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};

export default config;
