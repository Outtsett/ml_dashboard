/**
 * How the Claude panel renders markdown it did not write itself.
 */

/** Markdown images render as links: an image would be fetched the moment the
 *  text renders, so a model steered by injected content could send data it
 *  read to any host in the image URL, with no tool call and no approval. */
export const markdownComponents = {
  img: ({ src, alt }: { src?: string | Blob; alt?: string }) => {
    const href = typeof src === "string" ? src : "";
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className="text-[#56B4E9] underline">
        {alt || href || "image"}
      </a>
    );
  },
};
