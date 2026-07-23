Bridge Challenge

Static participant, MC and judging pages for the Bridge Challenge event.

Deployment
- Upload all project files together so HTML, JavaScript, CSS and assets remain on matching versions.
- Configure Firebase in config.js.
- Host the static files from the repository root.

Event payload protection
- Event-only display payloads are stored in Firebase Realtime Database, outside this repository.
- The client performs one-time reads only after the corresponding interaction is completed.
- Set /bridgeChallenge/config/hiddenContentEnabled to true shortly before the event and false afterward.
- The default behavior is disabled when the setting is missing or not exactly true.
- Do not commit the private payload import JSON to this repository.

Security limitation
This is a public client-side application. The payload separation prevents ordinary source inspection and initial page downloads from exposing event-only text, but an authenticated and determined user can still inspect network requests after completing an interaction.

Audio credit
Victory Chime by Scratchonix via Pixabay:
https://pixabay.com/sound-effects/musical-victory-chime-366449/
Used under the Pixabay Content License.
