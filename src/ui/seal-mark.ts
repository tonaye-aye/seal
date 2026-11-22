// Seal's logo, drawn by hand on a 20 by 20 grid. It is one flat shape with a
// round hole, so it works in any single colour: the top bar, the menu bar icon
// and the app icon all use these same numbers.
//
// The seal faces right with its head up, one flipper forward and a big forked
// tail. It is adapted from "Sappy Seal" by dob (CC BY 4.0, see the README).

/** The size of the grid the shape is drawn on. */
export const SEAL_GRID = 20;

/** The body, from the nose round the chest, flipper, belly, tail and back. */
export const SEAL_BODY =
  "M18.6 6.6C18.7 7.5 17.6 8.2 16.3 8.3C15.9 9.6 16 11 15.6 12.4C16.8 13.6 17.6 15 17.4 16.4C16 16.6 14.6 16 13.6 15.2C12.6 16.6 10.6 17.4 8.4 17.4C6.6 17.4 5 16.9 3.9 16C3 16.8 1.9 17.2 .9 17C1 15.8 1.6 14.8 2.5 14.2C1.7 13.4 1.1 12.3 1 11C2.4 11.2 3.7 11.9 4.7 12.9C6.6 12.6 8.2 11 9 9C9.7 7.2 10 5.6 11 4.3C12 3 13.6 2.4 15 2.7C16.8 3.1 18 4.6 18.6 6.6Z";

/** The dot on the head, which reads as the seal's eye. It is a hole in the body. */
export const SEAL_EYE = { cx: 14.7, cy: 5.6, r: 1.2 } as const;

/** The whole mark as one path. Draw it with the even-odd fill rule so the eye is a hole. */
export const SEAL_PATH = `${SEAL_BODY}M${SEAL_EYE.cx - SEAL_EYE.r} ${SEAL_EYE.cy}a${SEAL_EYE.r} ${SEAL_EYE.r} 0 1 0 ${SEAL_EYE.r * 2} 0a${SEAL_EYE.r} ${SEAL_EYE.r} 0 1 0 ${-SEAL_EYE.r * 2} 0Z`;
