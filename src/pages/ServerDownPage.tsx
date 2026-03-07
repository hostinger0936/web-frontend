// src/pages/ServerDownPage.tsx
export default function ServerDownPage() {
  return (
    <div className="min-h-screen bg-white text-[#202124] px-6 py-16">
      <div className="mx-auto max-w-[680px]">
        <div className="text-[28px] font-normal leading-tight">
          503. That’s an error.
        </div>

        <div className="mt-6 text-[15px] leading-7 text-[#3c4043]">
          The server is temporarily unavailable and could not complete your
          request.
          <br />
          Please try again in a few minutes.
        </div>

        <div className="mt-8 text-[13px] text-[#5f6368]">
          HTTP ERROR 503 — Service Unavailable
        </div>
      </div>
    </div>
  );
}