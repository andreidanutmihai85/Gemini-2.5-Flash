import React, { useEffect, useRef } from 'react';

interface VideoAvatarProps {
  isSpeaking: boolean;
}

const VIDEO_URL = 'https://cdn.pixabay.com/video/2022/10/18/135431-761676544_large.mp4';

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
    <div className="absolute inset-0 w-full h-full bg-black">
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