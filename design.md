# Tikfetch - Modern UI/UX Design System

## Design Philosophy & Aesthetics
Tikfetch features a minimalist, premium achromatic aesthetic inspired by modern developer tools (Vercel, Raycast, Linear). It combines high-contrast typography, subtle glassmorphism, fluid responsive layouts, and interactive micro-animations.

---

## 1. Color Palette
- **Canvas / Background**: `#fafafa` (Light mode) / `#09090b` (Dark accents)
- **Card Surface**: `#ffffff` with subtle border `rgba(0, 0, 0, 0.08)`
- **Primary Ink**: `#09090b`
- **Secondary Ink**: `#71717a` (Muted gray)
- **Borders & Dividers**: `#e4e4e7`
- **Accent Badge / Active**: `#09090b` (Dark pill) / `#f4f4f5` (Light hover)
- **Error / Alert**: `#ef4444` (Rose red accent)
- **Success**: `#10b981` (Emerald green accent)

---

## 2. Typography
- **Primary Font**: `Plus Jakarta Sans` / `Inter`, `-apple-system`, `BlinkMacSystemFont`
- **Monospace Font**: `JetBrains Mono` / `ui-monospace` for URL counts, file sizes, and video IDs
- **Hierarchy**:
  - H1 Display: `36px` - `48px` (Font weight: `700`, Tracking: `-0.04em`)
  - Subtitle: `14px` - `15px` (Font weight: `400`, Leading: `1.5`)
  - Section Headings: `16px` - `18px` (Font weight: `600`)
  - Badges & Buttons: `12px` - `14px` (Font weight: `500`)

---

## 3. Border Radii & Elevation
- **Outer Container Cards**: `28px` (`rounded-[28px]`)
- **Control Inputs & Primary Buttons**: `18px` (`rounded-[18px]`)
- **Badges & Tooltips**: `12px` - `14px`
- **Poster Cards**: `20px` (`aspect-[3/4]` or `aspect-[9/16]`)
- **Shadow System**: `0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.05)` with `1px` crisp border `border-[#e4e4e7]`.

---

## 4. Mobile & Desktop Hybrid Responsive Rules
- **Sticky Glass Top Bar**: Keeps brand header and mode tabs accessible on mobile screens.
- **Fluid Layout**: Max width centered at `780px` on desktop, `100%` on mobile with `16px` padding.
- **Mobile Sticky Bottom Bar**: When selecting videos in User Profile or running Batch Download, key action buttons (Download Selected, Download ZIP) stick to the bottom of the viewport on mobile devices for easy thumb access!
