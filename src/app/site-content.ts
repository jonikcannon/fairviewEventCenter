export type SiteContent = {
  site: {
    brand: string;
    title: string;
    description: string;
    contactEmail: string;
    footerText: string;
    socialLinks: { label: string; url: string }[];
  };
  navigation: Record<'home' | 'about' | 'eventCenter' | 'church', { label: string; visible: boolean }>;
  hero: {
    eyebrow: string;
    headline: string;
    intro: string;
    ctaLabel: string;
    ctaTarget: string;
    video: string;
    poster: string;
  };
  statement: { eyebrow: string; heading: string; copy: string };
  church: { eyebrow: string; heading: string; body: string };
  contact: { eyebrow: string; heading: string; email: string };
  // Embed URLs (Matterport/YouTube/etc.) for the "Virtual Tour" control in the
  // venue gallery, one per gallery category. Empty until an admin sets one.
  tours: { communityCenter: string; church: string };
};

export const defaultSiteContent: SiteContent = {
  site: {
    brand: 'Greater Harvest Church',
    title: 'Greater Harvest Church',
    description: 'Fairview Community Center — home of Greater Harvest Church.',
    contactEmail: 'hello@example.com',
    footerText: 'All rights reserved.',
    socialLinks: []
  },
  navigation: {
    home: { label: 'Home', visible: true },
    about: { label: 'About', visible: true },
    eventCenter: { label: 'Event Center', visible: true },
    church: { label: 'Church', visible: true }
  },
  hero: {
    eyebrow: 'Fairview Community Center',
    headline: 'A place to gather, worship, and grow.',
    intro: 'Home to Greater Harvest Church and open to the community for events, meetings, and celebrations.',
    ctaLabel: 'Plan your event',
    ctaTarget: 'eventCenter',
    video: '',
    poster: ''
  },
  statement: {
    eyebrow: 'Welcome',
    heading: 'Faith, fellowship, and community space.',
    copy: 'Join us for worship, or book the space for your next event.'
  },
  church: {
    eyebrow: 'Greater Harvest Church',
    heading: 'Worship, community, and belonging.',
    body: 'Service times and ministries are coming soon.'
  },
  contact: { eyebrow: 'Get in touch', heading: "Questions about worship or booking the center? Let's talk.", email: 'hello@example.com' },
  tours: { communityCenter: '', church: '' }
};
