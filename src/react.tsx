import type { AnselImage } from "./index.ts";
import { imgMarkup, type ImgOptions } from "./render.ts";

export interface ImgProps extends ImgOptions {
  /** An image imported with `?ansel`: `import drPatel from "./images/team/dr-patel.jpg?ansel"`. */
  image: AnselImage;
  /** Class for the wrapper element (the box the image fills). */
  className?: string | undefined;
}

/**
 * Responsive image with AVIF and WebP sources and an inline placeholder. Import
 * `@jayalfredprufrock/ansel/styles.css` once for the placeholder styles.
 */
export function Img({ image, className, ...options }: ImgProps) {
  const { placeholder, placeholderSrc, sources, img } = imgMarkup(image, options);
  const { fetchpriority, srcset, ...attributes } = img;
  return (
    <span className={className ? `ansel ${className}` : "ansel"} data-placeholder={placeholder}>
      {placeholderSrc && (
        <img className="ansel-placeholder" src={placeholderSrc} alt="" aria-hidden="true" />
      )}
      <picture>
        {sources.map(({ type, srcset: set, sizes }) => (
          <source key={type} type={type} srcSet={set} sizes={sizes} />
        ))}
        <img {...attributes} srcSet={srcset} fetchPriority={fetchpriority} />
      </picture>
    </span>
  );
}
