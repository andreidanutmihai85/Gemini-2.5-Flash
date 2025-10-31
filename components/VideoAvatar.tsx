import React, { useEffect, useRef } from 'react';

interface VideoAvatarProps {
  isSpeaking: boolean;
}

const VIDEO_URL = 'https://files2.heygen.ai/aws_pacific/avatar_tmp/fb46759e76394978bf32c819948684b0/vaURJqljRCydrzTMVkWllQIm0GwYfbeh2/1ec11652d32c4566ad6450721797ca85.mp4?Expires=1762521515&Signature=Ju5Z9WNzsoLhl08Cul-EQ3jwXWN66t7qZtkyf8na3WbbI8jckENzYLKXynfiNtjfPP~MF9W95TcMucSP3zIzVcXqM8hB45YayC22U~tkqi18HPu9i91RZmyQ4kJtl8rO8d4emaxRcrOgEy8NuZ3hAI1l4hlyROh80DETmeG~kzpD-ew-sExEdfOiE~-gC2D5l8YF5AgtTFdwhNYLLzYPv3bLpDDjUGfn0JiyKUxGIADskgkzduzfbsrShhwRzTnLCtfNhFO~Q41FQ5eG9IvgaJMon64Z3ek8dEsPG2wGjlBux~coFzScUIEEQ7SWHw-nc~muy1ZKPGV46isRTCENxQ__&Key-Pair-Id=K38HBHX5LX3X2H';

export const VideoAvatar: React.FC<VideoAvatarProps> = ({ isSpeaking }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isSpeaking) {
      // Play the video, handle promise rejection for autoplay policies
      video.play().catch(error => {
        // Autoplay was prevented.
        console.warn("Video play failed:", error);
      });
    } else {
      video.pause();
    }
  }, [isSpeaking]);

  return (
    <div className="flex-grow flex items-center justify-center bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        src={VIDEO_URL}
        loop
        muted // Audio comes from the API, not the video file.
        playsInline // Important for iOS.
        className="w-full h-full object-cover"
        aria-label="Video of an AI assistant"
      />
    </div>
  );
};