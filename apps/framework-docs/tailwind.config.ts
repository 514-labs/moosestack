import type { Config } from "tailwindcss";

const config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx,md,mdx}",
    "./components/**/*.{ts,tsx,md,mdx}",
    "./mdx-components.tsx",
    "./theme.config.jsx",
    "../../packages/**/!(*node_modules)/**/*.{ts,tsx,md,mdx}",
  ],
  safelist: [
    "active",
    "lg:-mx-48",
    {
      pattern: /^col-span-\d+$/,
      variants: ["sm", "md", "lg", "xl", "2xl"],
    },
    {
      // Add opacity numbers to bg color pattern
      pattern: /^bg-/,
      variants: ["hover"],
    },
    {
      pattern: /^text-/,
      variants: ["hover"],
    },
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
      },
      padding: {
        DEFAULT: "1rem",
        sm: "2rem",
        lg: "4rem",
        xl: "5rem",
      },
    },
    extend: {
      screens: {
        "3xl": "1792px",
      },
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
        "moose-green": {
          DEFAULT: "hsl(var(--accent-moo-green))",
          background: "hsla(var(--accent-moo-green), 0.2)",
          foreground: "hsl(var(--accent-moo-green-foreground))",
          hover: "hsla(var(--accent-moo-green), 0.9)",
        },
        "moose-indigo": {
          DEFAULT: "hsl(var(--accent-moo-indigo))",
          background: "hsla(var(--accent-moo-indigo), 0.2)",
          foreground: "hsl(var(--accent-moo-indigo-foreground))",
          hover: "hsla(var(--accent-moo-indigo), 0.9)",
        },
        "moose-purple": {
          DEFAULT: "hsl(var(--accent-moo-purple))",
          background: "hsla(var(--accent-moo-purple), 0.2)",
          foreground: "hsl(var(--accent-moo-purple-foreground))",
          hover: "hsla(var(--accent-moo-purple), 0.9)",
        },
        "moose-pink": {
          DEFAULT: "hsl(var(--accent-moo-pink))",
          background: "hsla(var(--accent-moo-pink), 0.2)",
          foreground: "hsl(var(--accent-moo-pink-foreground))",
          hover: "hsla(var(--accent-moo-pink), 0.9)",
        },
        "moose-yellow": {
          DEFAULT: "hsl(var(--accent-moo-yellow))",
          background: "hsla(var(--accent-moo-yellow), 0.2)",
          foreground: "hsl(var(--accent-moo-yellow-foreground))",
          hover: "hsla(var(--accent-moo-yellow), 0.9)",
        },
        "sloan-teal": {
          DEFAULT: "hsl(var(--accent-bor-tea))",
          background: "hsla(var(--accent-bor-tea), 0.2)",
          foreground: "hsl(var(--accent-bor-tea-foreground))",
          hover: "hsla(var(--accent-bor-tea), 0.9)",
        },
        "boreal-teal": {
          DEFAULT: "hsl(var(--accent-bor-tea))",
          background: "hsla(var(--accent-bor-tea), 0.2)",
          foreground: "hsl(var(--accent-bor-tea-foreground))",
          hover: "hsla(var(--accent-bor-tea), 0.9)",
        },
        "boreal-green": {
          DEFAULT: "hsl(var(--accent-bor-green))",
          background: "hsla(var(--accent-bor-green), 0.2)",
          foreground: "hsl(var(--accent-bor-green-foreground))",
          hover: "hsla(var(--accent-bor-green), 0.9)",
        },
        "boreal-yellow": {
          DEFAULT: "hsl(var(--accent-bor-yellow))",
          background: "hsla(var(--accent-bor-yellow), 0.3)",
          foreground: "hsl(var(--accent-bor-yellow-foreground))",
          hover: "hsla(var(--accent-bor-yellow), 0.9)",
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
        sidebar: {
          background: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
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
        "caret-blink": {
          "0%,70%,100%": {
            opacity: "1",
          },
          "20%,50%": {
            opacity: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
