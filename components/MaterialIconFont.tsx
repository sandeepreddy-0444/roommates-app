/**
 * Loads Google Material Symbols Outlined from fonts.googleapis.com.
 * Place once in the root layout next to <body>.
 */
export function MaterialIconFont() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
        rel="stylesheet"
      />
    </>
  );
}
