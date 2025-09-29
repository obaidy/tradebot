export function OctopusLoader() {
  return (
    <div className="octobot-loader" aria-hidden="true">
      <svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="octobot-loader-core" cx="50%" cy="36%" r="62%">
            <stop offset="0%" stopColor="#22D3EE" />
            <stop offset="60%" stopColor="#0EA5E9" />
            <stop offset="100%" stopColor="#1E1B4B" />
          </radialGradient>
          <linearGradient id="octobot-loader-tentacle" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#F472B6" />
          </linearGradient>
        </defs>
        <g className="octobot-loader__glow">
          <ellipse cx="48" cy="70" rx="30" ry="10" fill="rgba(34, 211, 238, 0.35)" />
        </g>
        <g className="octobot-loader__tentacle" stroke="url(#octobot-loader-tentacle)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M14 56c6 9 16 15 26 17" />
        </g>
        <g className="octobot-loader__tentacle" stroke="url(#octobot-loader-tentacle)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M8 49c8 12 24 21 36 23" />
        </g>
        <g className="octobot-loader__tentacle" stroke="url(#octobot-loader-tentacle)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M82 56c-6 9-16 15-26 17" />
        </g>
        <g className="octobot-loader__tentacle" stroke="url(#octobot-loader-tentacle)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M88 49c-8 12-24 21-36 23" />
        </g>
        <path
          className="octobot-loader__body"
          d="M48 18c-14 0-26 10-26 24 0 15 12 30 26 30s26-15 26-30c0-14-12-24-26-24z"
          fill="url(#octobot-loader-core)"
        />
        <ellipse className="octobot-loader__eye" cx="36" cy="38" rx="5" ry="6" fill="#F8FAFC" opacity="0.92" />
        <ellipse className="octobot-loader__eye" cx="60" cy="38" rx="5" ry="6" fill="#F8FAFC" opacity="0.92" />
        <circle cx="36" cy="39" r="2.4" fill="#0F172A" />
        <circle cx="60" cy="39" r="2.4" fill="#0F172A" />
        <path d="M38 48c3 2 7 3 10 3s7-1 10-3" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}
