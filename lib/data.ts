// Site content. Recovered verbatim from the production bundle.

export const LOCATION = "Los Angeles, CA";
export const EMAIL = "contact@christopherngai.com";

export const EXPERIENCE = [
  {
    company: "Modern Animal",
    period: "2019 - Present",
    title: "Staff Software Engineer",
    summary:
      "Grew from intern to Staff Engineer over 6 years at a tech-forward veterinary company, helping scale products to 90,000 members and $95M revenue.",
    achievements: [
      "Drove $2.1M ARR by architecting Autoship subscriptions (billing, EMR, e-commerce), reaching 4,100+ active subs and doubling ship dispense rate from 5% to 10% in 6 months.",
      "Led integration with one of the nation's largest pet pharmacies, shipping 10k+ orders with zero major incidents, expanding catalog by 3x, and saving 190+ ops hours/week.",
      "Introduced AI dev workflows across a 14-engineer team, building Slack-to-GitHub automation on AWS Lambda and driving adoption of agentic coding tools, saving 400+ hours/year.",
    ],
  },
];

export const PROJECTS = [
  {
    name: "Elsewhere",
    tagline: "iOS Social Media App",
    role: "Founding Engineer",
    period: "2025 - Present",
    summary:
      "Building a back-to-basics social app: chronological feed, no algorithms, no vanity metrics. Built with Swift, Go, ScyllaDB. 100+ beta users in first month.",
    achievements: [
      "Designed and shipped a fast, fluid media experience end-to-end with real-time Websocket feed, multi-image/video posting, and a custom media pipeline handling compression and transcoding.",
      "Building Go backend on self-hosted Kubernetes with ScyllaDB and Cloudflare Workers CDN, optimizing for low-latency media delivery.",
    ],
  },
];

export const EDUCATION_HONORS = ["Dean's Honors List"];

export const EDUCATION_ACTIVITIES = [
  {
    organization: "Campus Events Commission, UCLA",
    period: "2017 - 2020",
    role: "Web Development Director",
    achievements: [
      "Managed team of 10 developers building web and mobile apps for campus-wide events.",
      "Built Bruin Bash concert website serving 40,000+ UCLA students.",
    ],
  },
];

export const SKILLS = [
  { category: "Languages", items: ["TypeScript", "JavaScript", "Python"] },
  { category: "Frontend", items: ["React", "React Native", "GraphQL", "Apollo", "Redux", "Zustand"] },
  { category: "Backend", items: ["Django", "PostgreSQL", "Celery", "Redis", "Strawberry GraphQL"] },
  { category: "AI Tooling", items: ["Claude Code", "Cursor", "Codex", "GitHub Copilot", "MCP", "Langchain"] },
  { category: "Cloud & Infra", items: ["AWS (ECS, Lambda, S3, CloudFront)", "Google Cloud", "Docker"] },
  { category: "Testing", items: ["Jest", "React Testing Library"] },
];

export const INTERESTS = [
  { label: "Cooking", description: "Always experimenting with new cuisines. My kitchen doubles as a food lab and cultural deep dive." },
  { label: "Puzzles", description: "Jigsaw puzzles as meditation. There's something deeply satisfying about finding order in a pile of chaos." },
  { label: "Soccer", description: "Playing since I was 5 and still at it. Grew up enjoying Bayern Munich and Barcelona." },
  { label: "3D Printing", description: "Recently got a Bambu A1 Mini and been printing practical things. Early days, but fully hooked." },
  { label: "Golf", description: "Picked it up as an adult hobby and fully embracing the beginner's journey. Still trying to find the fairway." },
  { label: "Asian Literature", description: "Drawn to surrealist storytelling and rich cultural atmosphere. Currently deep into Murakami and Uketsu." },
];

export const SECTIONS = [
  { id: "intro", label: "Intro" },
  { id: "experience", label: "Experience" },
  { id: "projects", label: "Projects" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
  { id: "interests", label: "Interests" },
] as const;
