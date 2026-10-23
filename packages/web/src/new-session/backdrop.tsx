import { createUniqueId, type JSX } from "solid-js"

import "./backdrop.css"

// Our logo geometry from `ui/components/spinner.tsx`: capsule silhouette plus
// its five color segments. Same shapes, only the Linear-style finish is new.
const OUTLINE =
  "M101.75,5.5h0C48.59,5.5,5.5,48.59,5.5,101.75v27.5c0,53.16,43.09,96.25,96.25,96.25h0c53.16,0,96.25-43.09,96.25-96.25v-27.5c0-53.16-43.09-96.25-96.25-96.25Z"
const SEGMENTS = [
  { d: "M0,0H210V54.39H0Z", fill: "#ffe457" },
  { d: "M0,54.39L90,54.37L37.75,127.71L0,127.71Z", fill: "#ee3726" },
  { d: "M90,54.37L210,54.39L210,127.71L37.75,127.71Z", fill: "#ff9c36" },
  { d: "M0,127.71L90,127.71L46.91,208.38L0,230Z", fill: "#22afff" },
  { d: "M90,127.71L210,127.71L210,230L0,230L46.91,208.38Z", fill: "#4ec722" },
]

/** Our logo silhouette with the Linear etched-glass finish, behind new-session. */
export function SessionBackdrop(): JSX.Element {
  const id = createUniqueId()
  const clip = `session-backdrop-clip-${id}`
  const stroke = `session-backdrop-stroke-${id}`
  const fade = `session-backdrop-fade-${id}`
  const mask = `session-backdrop-mask-${id}`
  const soft = `session-backdrop-soft-${id}`
  const glow = `session-backdrop-glow-${id}`

  return (
    <div data-component="session-backdrop" aria-hidden="true">
      <svg width="297" height="336" viewBox="0 0 204 231" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clip-path={`url(#${clip})`}>
          {SEGMENTS.map((segment) => (
            <path
              d={segment.d}
              fill={segment.fill}
              fill-opacity="0.07"
              stroke="var(--color-border-base)"
              stroke-opacity="0.35"
              stroke-width="0.5"
              vector-effect="non-scaling-stroke"
              stroke-linejoin="round"
            />
          ))}
        </g>
        <g clip-path={`url(#${clip})`} mask={`url(#${mask})`} filter={`url(#${soft})`} fill="none">
          {SEGMENTS.map((segment) => (
            <path
              d={segment.d}
              stroke={`url(#${stroke})`}
              stroke-width="0.5"
              vector-effect="non-scaling-stroke"
              stroke-linejoin="round"
            />
          ))}
          <path d={OUTLINE} stroke={`url(#${stroke})`} stroke-width="0.5" vector-effect="non-scaling-stroke" />
        </g>
        <g clip-path={`url(#${clip})`} opacity="0.12" filter={`url(#${glow})`} fill="none">
          {SEGMENTS.map((segment) => (
            <path
              d={segment.d}
              stroke={`url(#${stroke})`}
              stroke-width="0.5"
              vector-effect="non-scaling-stroke"
              stroke-linejoin="round"
            />
          ))}
          <path d={OUTLINE} stroke={`url(#${stroke})`} stroke-width="0.5" vector-effect="non-scaling-stroke" />
        </g>
        <defs>
          <clipPath id={clip}>
            <path d={OUTLINE} />
          </clipPath>
          <linearGradient id={stroke} x1="102" y1="231" x2="102" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="var(--color-border-strong)" />
            <stop offset="50%" stop-color="var(--color-border-strong)" />
            <stop offset="100%" stop-color="var(--color-text-accent)" />
          </linearGradient>
          <filter id={soft} x="-50%" y="-50%" width="200%" height="200%" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
            <feFlood flood-opacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="2" result="effect1_foregroundBlur" />
          </filter>
          <filter id={glow} x="-50%" y="-50%" width="200%" height="200%" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
            <feFlood flood-opacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feGaussianBlur stdDeviation="2" result="effect1_foregroundBlur" />
          </filter>
          <linearGradient id={fade} x1="102" y1="0" x2="102" y2="231" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="white" stop-opacity="0" />
            <stop offset="60%" stop-color="white" stop-opacity="1" />
          </linearGradient>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="204" height="231">
            <rect x="0" y="0" width="204" height="231" fill={`url(#${fade})`} />
          </mask>
        </defs>
      </svg>
    </div>
  )
}
