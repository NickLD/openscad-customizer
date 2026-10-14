/** The app mark: a cube with a slider face. Same drawing as public/favicon.svg; colours follow the app theme. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg class="logo" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path d="M32 5 56 18.5 32 32 8 18.5Z" fill="#fde68a" />
      <path d="M8 18.5 32 32v27L8 45.5Z" fill="#f9d72c" />
      <path class="logo-panel" d="M56 18.5 32 32v27l24-13.5Z" />
      <path class="logo-outline" d="M32 5 56 18.5v27L32 59 8 45.5v-27Z M8 18.5 32 32 56 18.5 M32 32v27" fill="none" stroke-width="3" stroke-linejoin="round" />
      <path class="logo-track" d="M37 33.5 51 25.6M37 41.5 51 33.6M37 49.5 51 41.6" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="47" cy="27.9" r="2.6" fill="#f9d72c" />
      <circle cx="40.5" cy="39.5" r="2.6" fill="#f9d72c" />
      <circle cx="45" cy="44.9" r="2.6" fill="#f9d72c" />
    </svg>
  );
}
