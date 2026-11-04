type Props = {
  className?: string;
  size?: number;
};

/** ScholarGraph's source mark: an open book with a small connected citation graph. */
export default function ScholarGraphMark({ className = '', size = 40 }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7.5 11.5C13.1 9.3 18.4 10.4 24 15v23c-5.6-4.6-10.9-5.7-16.5-3.5v-23Z"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinejoin="round"
      />
      <path
        d="M40.5 11.5C34.9 9.3 29.6 10.4 24 15v23c5.6-4.6 10.9-5.7 16.5-3.5v-23Z"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinejoin="round"
      />
      <path
        d="M14 18.5c2 .1 3.9.7 5.8 1.8M14 24c1.5.1 2.8.5 4.2 1.1m15.8-9.7-5.2 5.2h-4.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="31.8" cy="14.7" r="2.8" fill="var(--sg-accent, #bb7448)" />
      <circle cx="24.4" cy="20.6" r="2.1" fill="currentColor" />
    </svg>
  );
}
