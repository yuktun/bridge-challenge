Bridge Challenge v1.6.1

Fixes:
- Corrected final load wording to exactly "2.5 kg object".
- Restored the v1.5 visual design and CSS.
- Restored working password input and login behavior on MC, Teamwork, Innovation and Load Test pages.
- Added dynamic 5/6/7 team support.
- Added Kitty's live final result board.
- Added MC award winner selection and reset.
- Added live winners to participant Awards tab.
- Updated checklist wording and order.
- Teamwork and Load Test autosave remain enabled.

Upload every file in this package together to avoid mixing old JavaScript and CSS.
Password: gicgic


Version 1.6.2
- Team count selector expanded to 2–10.
- Kitty page now definitely includes the full MC-style result board.
- MC and Kitty result boards are sorted by highest total score first.
- Tie-breaking order: Total, Strength, Teamwork, then original team number.
- Exact ties share the same rank.
- Changing team count does not delete hidden scores.


Version 1.6.3
- Fixed judge-page completion counters after changing the team count.
- Teamwork, Innovation and Load Test now immediately display the active denominator.
- Initial HTML no longer briefly shows a hard-coded /6 value.


Version 1.6.4
- Fixed Kitty's Final Result Board showing no data.
- Cause: the board listener referenced an undefined variable named scoreRef.
- Kitty's board now reads the same Teamwork, Strength and Innovation Firebase paths as the MC board.
- Saved Teamwork scores are restored correctly after changing the number of teams.


Version 1.7 — Secret bonus game
- Completing all checklist items starts a 5-second delay, then reveals a surprise Bonus Game button.
- Added bonus-game.html based on the uploaded Bridge Builder game.
- Bonus leaderboard is stored live in Firebase.
- Players select their team before playing.
- A score of 10 or above can unlock one extra resource for that team.
- Firebase transaction ensures each team can unlock the resource only once.
- The success screen tells the first qualifying player to check with the event team.
- MC page shows bonus leaderboard/reward status and can clear all bonus results.


Version 1.7.1
- Fixed Play Again remaining on the Game Over screen after submitting a score.
- The Game Over and Leaderboard overlays are fully closed before restarting.
- The player name, reward message and Submit button reset for the next game.


Version 1.7.2
- Fixed iPhone team selection.
- Gameplay touch handling is now limited to the game canvas instead of the whole browser window.
- Native select, text input and buttons now work normally on iPhone.
- Fixed Leaderboard buttons and automatic Leaderboard opening after score submission.
- Both the header trophy button and Game Over Leaderboard button now use the same reliable open function.


Version 1.7.3
- Fixed iPhone game freezing after touch-and-hold.
- Replaced separate touch handlers with pointer events and pointer capture.
- Added release fallbacks for Safari, lost pointer capture, app switching and window blur.
- Audio startup can no longer block gameplay.
- Welcome screen is scrollable on short iPhone screens.
- Start Building button is sticky and remains visible at the bottom.
- Game canvas resizes correctly for iPhone browser bars and orientation changes.


Version 1.7.4
- Fixed iPhone bridge getting stuck after the first hold.
- Removed Safari pointer capture, which could cancel the hold immediately.
- iPhone now uses touchstart plus document-level touchend/touchcancel.
- Releasing outside the canvas still drops the bridge.
- Desktop mouse controls remain unchanged.


Version 1.7.6
- Removed the explanatory sentence under the Checklist bonus-game reveal.
- Replaced bonus-game.html with the user's uploaded working version.
- The uploaded game includes the iPhone audio-throttling fix and Firebase leaderboard.


Version 1.7.7
- Fixed the top-right trophy button in bonus-game.html by linking it to the correct leaderboardBtn ID.
- Used the user's uploaded working bonus-game.html as the base.
- Added a hidden fourth Design Lab question.
- The secret question appears only after all three hints are unlocked and Hint 3's image is double-clicked or double-tapped.
- Correct answer: DBS Lighthouse.
- Teams select their team before answering.
- Firebase transaction permits each team to unlock the hidden extra resource only once.
- Successful first claim tells the team to check with the event team.
- MC page can view and clear hidden Design Lab bonus claims.


Version 1.7.8
- Triple-click/tap the Innovation card on the Intel page to reveal a playful warning.
- User selects their team and accepts the fake penalty.
- First claim for each team reveals an extra resource reward and directs them to the event team.
- Each team can claim the Intel dare bonus only once through Firebase transaction control.
- MC page can view and clear Intel dare-bonus claims.
- Checklist bonus game now unlocks after only the first three checklist items are checked for five seconds.
- Checklist progress bar still reflects all checklist items.


Version 1.7.9
- Automatically checks whether a team completed all three hidden activities:
  1. Bonus Game score reward
  2. Design Lab hidden question
  3. Intel Innovation dare
- When a team completes all three for the first time, the MC page publishes a live success announcement:
  "SUPER BONUS! [Team] has passed all three hidden challenges. Please come forward now to collect your SUPER EXTRA RESOURCE!"
- Firebase transaction control prevents duplicate announcements for the same team.
- MC page shows completed Super Bonus teams and can reset Super Bonus announcement records.


Version 1.7.10
- Fixed Super Bonus not being detected after a team completed all three hidden activities.
- Root cause: mc.js called Firebase runTransaction() without importing it.
- Added the missing runTransaction import.
- Automatic Super Bonus errors now appear visibly in the MC Super Bonus section.


Version 1.7.11
- Super Bonus winner announcements now use a dedicated Firebase path.
- Normal Live Announcement messages no longer replace or remove the Super Bonus winner message.
- Every team that completes all three hidden challenges remains listed in the Super Bonus announcement.
- MC page shows a dedicated Super Bonus announcement preview.
- Added Clear Winner Message to clear only the dedicated Super Bonus message.
- Reset Super Bonus clears the winner message and Super Bonus tracking records.


Version 1.7.12
- Added more space below the dedicated Super Bonus announcement so it does not visually touch the timer or other page modules.


Version 1.7.13
- Final Award Winners now supports multiple winning teams for each award.
- MC uses checkbox choices rather than a single-team dropdown.
- Selections save automatically to Firebase.
- Participant Awards tab displays every selected team.
- Existing single-team award data remains backward compatible.


Version 1.7.14
- Intel > Official Scoring now displays live Load Test results.
- Each team appears on the row representing its highest passed stage.
- Example: a team that passed stages 1, 2 and 3 appears on stage 3 only.
- Results update automatically from Firebase.
- Team display follows the active team count selected by the MC.


Version 1.7.15
- Fixed the live Load Test result layout on desktop and iPhone.
- Desktop now uses a balanced four-column layout for stage, description, teams and points.
- Team chips wrap cleanly without merging together.
- iPhone uses a two-row layout: stage details and points above, team chips below.
- Existing visual style and live Firebase behavior are unchanged.


Version 1.7.16
- Fixed desktop Load Test results overflowing outside the Official Scoring card.
- Desktop rows now use a stable three-column layout: stage number, test details and points.
- Team result chips appear directly below each test description and always remain inside the card.
- iPhone layout remains unchanged.


Version 1.7.17
- Restored the MC control-page appearance to the last known-good v1.7.13 styling.
- Added mc-styles.css exclusively for mc.html.
- Participant and judge pages continue using the latest styles.css, including the Load Test layout fixes.
- MC functionality and Firebase logic are unchanged.


Version 1.7.18
- Added a hidden Interactive Mission Setup Easter egg.
- Click or tap the red LOAD block three times within 1.8 seconds.
- The load grows, drops onto the demo bridge and visually breaks it.
- A playful Critical Overload message appears.
- Closing the message automatically repairs and resets the diagram.
- This is visual only and does not affect Firebase or scoring.


Version 1.7.19
- Updated the Bonus Game top-left title from BRIDGE CHALLENGE to GIC BRIDGE CHALLENGE.


Version 1.7.20
- Added an independent four-tap coffee-can disturbance joke to each mission diagram can.
- Added a three-tap fake gap-violation warning that resets the diagram after closing.
- Added a reusable Team Spirit confetti button after the first three checklist items are complete.
- Team Spirit includes a five-second cooldown and reduced-motion support.
- All three additions are visual only and do not read from or write to Firebase.


Version 1.7.21
- Team Spirit now unlocks when the first checklist item is checked.
- The existing first-three-items, five-second Bonus Game unlock remains unchanged.


Version 1.7.37
- Added an original short winning-bell sound for new Super Bonus award announcements only.
- Each Super Bonus award now carries a unique event ID and plays once per participant device.
- Played event IDs are remembered locally to prevent replay after refresh, reconnect or duplicate Firebase updates.
- Audio is unlocked on the participant's first interaction, with a remembered sound on/off control.
