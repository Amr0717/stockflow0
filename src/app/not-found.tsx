import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto mt-24 max-w-md px-4 text-center">
      <p className="ltr-value text-5xl font-bold text-accent">404</p>
      <h1 className="mt-3 text-lg font-semibold">الصفحة غير موجودة · Page not found</h1>
      <Link href="/" className="mt-5 inline-block text-sm font-medium text-accent hover:underline">
        العودة إلى لوحة التحكم · Back to dashboard
      </Link>
    </main>
  );
}
