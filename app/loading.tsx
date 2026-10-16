import LoadingState from "@/components/ui/LoadingState";

export default function Loading() {
  return <div className="mx-auto w-full max-w-3xl px-4 py-12"><LoadingState title="Loading page..." description="Please wait while we prepare your page." /></div>;
}
