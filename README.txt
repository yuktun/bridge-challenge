Bridge Challenge

Static participant, MC and judging pages for the Bridge Challenge event.

Deployment
- Run `npm install` once and `npm run build` before publishing.
- The participant page loads `assets/app.min.js` and `assets/app.min.css`.
- Keep the readable participant source under `src/`; do not point index.html at it.
- Upload all project files together so HTML, JavaScript, CSS and assets remain on matching versions.
- Configure Firebase in config.js.
- Host the static files from the repository root.

Event payload protection
- Event-only display payloads are stored in Firebase Realtime Database, outside this repository.
- The client signs in anonymously, verifies the event switch, then loads a neutral interaction manifest.
- Event display payloads continue to use one-time reads when required.
- Set /bridgeChallenge/config/hiddenContentEnabled to true shortly before the event and false afterward.
- The default behavior is disabled when the setting is missing or not exactly true.
- Do not commit the private payload import JSON to this repository.

Security limitation
This is a public client-side application. The payload separation prevents ordinary source inspection and initial page downloads from exposing event-only text, but an authenticated and determined user can still inspect network requests after completing an interaction.

Audio credit
Victory Chime by Scratchonix via Pixabay:
https://pixabay.com/sound-effects/musical-victory-chime-366449/
Used under the Pixabay Content License.
