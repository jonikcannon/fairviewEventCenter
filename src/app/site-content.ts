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
    // Diameter in pixels of the logo badge shown above the hero copy (see
    // .hero-logo in app.component.css, sized off the --hero-logo-size
    // custom property this drives).
    logoSize: number;
    // Font sizes (px) for the three hero text pieces, each driving a
    // --hero-*-size custom property in app.component.css. Mobile scales
    // these down proportionally rather than using a separate field.
    eyebrowSize: number;
    headlineSize: number;
    introSize: number;
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
    // renders without one. `price` is optional free text (e.g. "$50" or
    // "$25/session") and empty when a feature has no separate cost.
    features: { title: string; description: string; image: string; price: string }[];
  };
  contact: {
    eyebrow: string;
    heading: string;
    email: string;
    // Street address geocoded for the "Get directions" link and map embed
    // on the Contact section (see AppComponent.directionsUrl/mapEmbedUrl).
    address: string;
    faq: { question: string; answer: string }[];
  };
  rates: {
    eyebrow: string;
    heading: string;
    intro: string;
    // Empty means no rate schedule has been uploaded yet (see RatesComponent).
    document: string;
    // Admin-editable line items shown as a price list, independent of the
    // uploaded document above. `detail`/`price`/`category` are optional free
    // text; items sharing a `category` are grouped under that heading (see
    // RatesComponent), matching the source pricing schedule's own sections
    // (e.g. "All-Season Days" vs "Special Community Events Only").
    items: { name: string; detail: string; price: string; category: string }[];
  };
  // Controls for the "Virtual Tour" tab in the venue gallery. An embed URL
  // (Matterport/YouTube/etc.) takes priority when set; otherwise the
  // self-hosted panorama photo is shown in an interactive pan/zoom viewer
  // (see PanoramaViewerComponent). Both empty until an admin sets one.
  tours: { communityCenter: string; panoramaImage: string };
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
    poster: '',
    logoSize: 148,
    eyebrowSize: 9,
    headlineSize: 60,
    introSize: 13
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
  contact: {
    eyebrow: 'Get in touch',
    heading: "Questions about booking the center? Let's talk.",
    email: 'hello@example.com',
    address: '1053 Panola Rd #3029, Ellenwood, GA 30294',
    faq: [
      {
        question: 'How do I book a date?',
        answer: "Pick an open date on the Booking page and pay the reservation fee online to hold it, or reach out here and we'll help you find one."
      },
      {
        question: 'What does the reservation fee cover?',
        answer: 'The reservation fee is paid up front to hold your date. The rental fee is separate and due 15 days before your event.'
      },
      {
        question: 'Can I tour the space before booking?',
        answer: 'Yes -- reach out to schedule a walkthrough, or check the Event Center page for photos and a virtual tour.'
      },
      {
        question: "What's the cancellation policy?",
        answer: 'Reservation fees are refundable up until the refund window shown on your booking confirmation. After that window, the fee is non-refundable.'
      }
    ]
  },
  rates: {
    eyebrow: 'Pricing',
    heading: 'Rate schedule',
    intro: 'Current rental and reservation fees for the Fairview Community Center. Reach out if you have questions about a specific date.',
    document: '',
    items: [
      { name: 'Standard Package (Morning Only)', detail: 'Community Center, Picnic Pavilion & Ball Field · 9:00 AM – 3:00 PM', price: '$995.00', category: 'All-Season Days' },
      { name: 'Standard Package (Evening Only)', detail: 'Community Center, Picnic Pavilion & Ball Field · 5:00 PM – 10:00 PM', price: '$1,200.00', category: 'All-Season Days' },
      { name: 'Standard Package (All Day)', detail: 'Community Center, Picnic Pavilion & Ball Field · 9:00 AM – 10:00 PM', price: '$1,750.00', category: 'All-Season Days' },
      { name: 'Community Center Only (Weekday)', detail: 'Monday–Thursday · 6-hour minimum', price: '$125.00/hour', category: 'All-Season Days' },
      { name: 'Bereavement Package', detail: 'Community Center · 6 hours', price: '$750.00', category: 'Special Community Events Only' },
      { name: 'Sunday Event', detail: 'Community Center, Picnic Pavilion & Ball Field · 1:00 PM – 8:00 PM', price: '$1,200.00', category: 'Special Community Events Only' },
      { name: 'Refundable Rental Deposit', detail: 'Required for all bookings', price: '$175.00', category: '' }
    ]
  },
  tours: { communityCenter: '', panoramaImage: '' },
  theme: { primary: '#26362e', background: '#f4f2ec', text: '#1f211d' }
};
