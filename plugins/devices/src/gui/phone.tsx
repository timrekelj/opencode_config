/** A phone outline; the app's icon catalog has none. Draws in `currentColor`. */
export function PhoneIcon(props: { class?: string }) {
  return (
    <svg class={props.class ?? "dev-phone-icon"} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="1.5" width="8" height="13" rx="1.75" stroke="currentColor" stroke-width="1.25" />
      <path d="M7 12.25h2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </svg>
  )
}
