export type SiteContent = {
  site: {
    brand: string;
    title: string;
    description: string;
    contactEmail: string;
    footerText: string;
    socialLinks: { label: string; url: string }[];
    // Empty means "use the bundled crest" (see AppComponent.logoMark) until
    // an admin uploads a replacement through the Site content form.
    logo: string;
  };
  navigation: Record<'home' | 'about' | 'eventCenter' | 'booking', { label: string; visible: boolean }>;
  hero: {
    eyebrow: string;
    headline: string;
    intro: string;
    ctaLabel: string;
    ctaTarget: string;
    // Empty means "use the built-in default" (see AppComponent.heroVideo /
    // heroPoster) -- these only take effect once an admin uploads a
    // replacement.
    video: string;
    poster: string;
  };
  statement: { eyebrow: string; heading: string; copy: string };
  about: {
    eyebrow: string;
    heading: string;
    /** Rendered in italics after `heading`, e.g. "Community, " + "together." */
    headingEmphasis: string;
    /** Paragraphs separated by a blank line. */
    body: string;
    ctaLabel: string;
    // Empty means "use the built-in default portrait" until an admin uploads one.
    portraitImage: string;
    // Customizable highlights shown below the main About copy. `image` is
    // empty until an admin uploads one for that feature -- unlike the
    // portrait there is no bundled default, so an imageless feature just
    // renders without one.
    features: { title: string; description: string; image: string }[];
  };
  contact: { eyebrow: string; heading: string; email: string };
  // Embed URL (Matterport/YouTube/etc.) for the "Virtual Tour" control in the
  // venue gallery. Empty until an admin sets one.
  tours: { communityCenter: string };
  // CSS custom properties applied at runtime (see AppComponent.applyTheme).
  // Defaults here match the values already baked into src/styles.css, so an
  // untouched theme renders identically to the original hardcoded palette.
  theme: { primary: string; background: string; text: string };
};

export const defaultSiteContent: SiteContent = {
  site: {
    brand: 'Fairview Community Center',
    title: 'Fairview Community Center',
    description: 'Fairview Community Center — event spaces, bookings, and galleries for weddings, meetings, and celebrations.',
    contactEmail: 'hello@example.com',
    footerText: 'All rights reserved.',
    socialLinks: [],
    logo: ''
  },
  navigation: {
    home: { label: 'Home', visible: true },
    about: { label: 'About', visible: true },
    eventCenter: { label: 'Event Center', visible: true },
    booking: { label: 'Booking', visible: true }
  },
  hero: {
    eyebrow: 'Fairview Community Center',
    headline: 'A place to gather, celebrate, and grow.',
    intro: 'Open to the community for weddings, meetings, and celebrations of every kind.',
    ctaLabel: 'Plan your event',
    ctaTarget: 'eventCenter',
    video: '',
    poster: ''
  },
  statement: {
    eyebrow: 'Welcome',
    heading: 'Community, celebration, and shared space.',
    copy: 'Book the space for your next event, meeting, or celebration.'
  },
  about: {
    eyebrow: 'WHO WE ARE',
    heading: 'Community,',
    headingEmphasis: 'together.',
    body: "Fairview Community Center is a shared space for the neighbors, families, and groups who gather here throughout the week.\n\nThe center opens its doors to weddings, celebrations, meetings, and events of every kind, with rooms and grounds to fit gatherings large and small.\n\nWhether you're planning a wedding, a meeting, or a celebration, we'd love to help you book the space.",
    ctaLabel: 'Get in touch',
    portraitImage: '',
    features: []
  },
  contact: { eyebrow: 'Get in touch', heading: "Questions about booking the center? Let's talk.", email: 'hello@example.com' },
  tours: { communityCenter: '' },
  theme: { primary: '#26362e', background: '#f4f2ec', text: '#1f211d' }
};
