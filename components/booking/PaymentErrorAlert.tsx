export default function PaymentErrorAlert({ message, issues }: { message: string; issues: string[] }) {
  return <div role="alert" className="mb-6 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900 shadow-sm">
    <p className="font-semibold">Payment could not be submitted</p>
    {issues.length ? <><ul className="mt-3 list-disc space-y-2 pl-5">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
      <p className="mt-3">Upload a clear, complete original GCash screenshot, correct the details above, then try again.</p></>
      : <p className="mt-2">{message}</p>}
  </div>;
}
