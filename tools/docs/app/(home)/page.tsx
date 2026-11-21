import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">Suite docs spike</h1>
      <p>This is the local reader spike, not a product surface.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Link className="underline" href="/docs">
            Docs page: !from and Mermaid
          </Link>
        </li>
        <li>
          <Link className="underline" href="/spike">
            Scrollycoding
          </Link>
        </li>
        <li>
          <Link className="underline" href="/spotlight">
            Spotlight
          </Link>
        </li>
      </ul>
    </div>
  );
}
