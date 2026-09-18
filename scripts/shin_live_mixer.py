import os
import sys
import subprocess
import argparse

def mix_live_video(video_path, voice_path, bgm_path=None, output_path=None, bgm_volume=0.18):
    if not os.path.exists(video_path):
        print(f'[ERROR] Không tìm thấy video: {video_path}')
        return False
    if not os.path.exists(voice_path):
        print(f'[ERROR] Không tìm thấy file voice: {voice_path}')
        return False

    if not output_path:
        output_path = os.path.join('outputs', 'livestream', 'shinchan_final_output.mp4')

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    print('[1/3] Đang xử lý hòa âm (Audio Mixing & Ducking)...')

    if bgm_path and os.path.exists(bgm_path):
        filter_complex = (
            f'[1:a]volume=1.8[voice];'
            f'[2:a]volume={bgm_volume}[bgm];'
            f'[bgm][voice]sidechaincompress=threshold=0.08:ratio=4:attack=50:release=300[ducked_bgm];'
            f'[voice][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]'
        )
        cmd = [
            'ffmpeg', '-y',
            '-stream_loop', '-1', '-i', video_path,
            '-i', voice_path,
            '-stream_loop', '-1', '-i', bgm_path,
            '-filter_complex', filter_complex,
            '-map', '0:v', '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac', '-b:a', '192k',
            '-shortest',
            output_path
        ]
    else:
        cmd = [
            'ffmpeg', '-y',
            '-stream_loop', '-1', '-i', video_path,
            '-i', voice_path,
            '-filter_complex', '[1:a]volume=1.8[aout]',
            '-map', '0:v', '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac', '-b:a', '192k',
            '-shortest',
            output_path
        ]

    print(f'[2/3] Đang xuất video thành phẩm qua FFmpeg...')
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode == 0:
        print(f'[3/3] THÀNH CÔNG! Video xuất tại:
👉 {output_path}')
        return True
    else:
        print('[ERROR] FFmpeg error:', res.stderr[-300:])
        return False

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Auto3Dvideo Shin-chan Live Mixer')
    parser.add_argument('--video', default='assets/videos/shin_dance.mp4')
    parser.add_argument('--voice', default='assets/voices/shin_sample.mp3')
    parser.add_argument('--bgm', default='assets/music/live_bgm.mp3')
    parser.add_argument('--output', default='outputs/livestream/shin_live_ready.mp4')
    args = parser.parse_args()
    print('=== AUTO3DVIDEO STUDIO: SHIN-CHAN LIVE PRODUCTION ===')
    mix_live_video(args.video, args.voice, args.bgm if os.path.exists(args.bgm) else None, args.output)
