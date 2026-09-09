import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { AppComponent } from './app/app.component';
import { loadMediaConfig } from './app/media-url';

// Resolve where gallery media is served from before the first render, so the
// hero video and the other hard-coded paths point at the bucket on their very
// first request instead of being rewritten a frame later.
loadMediaConfig()
  .then(() => bootstrapApplication(AppComponent, { providers: [provideAnimations()] }))
  .catch(err => console.error(err));
