from PIL import Image, ImageEnhance, ImageFilter

input_path = "C:/Users/GIGABYTE/.gemini/antigravity/brain/c37c45a8-857f-4f3a-abfa-b9f4bbe09eb2/.user_uploaded/media_1789284944337.jpg"
output_path = "D:/Duancanhan/Auto3Dvideo/shinchan_live_perfect_16_9.jpg"

img = Image.open(input_path).convert("RGB")
W, H = img.size

# 1. Khử mờ, tăng độ sắc nét cực đại
enhancer = ImageEnhance.Sharpness(img)
sharp_img = enhancer.enhance(1.85)

contrast_enhancer = ImageEnhance.Contrast(sharp_img)
crisp_img = contrast_enhancer.enhance(1.08)

# 2. Mở rộng phần sân đá cobblestone phía dưới thêm 40% để đẩy nhân vật lùi ra xa
extra_floor_h = int(H * 0.40)
new_H = H + extra_floor_h

new_img = Image.new(RGB, (W, new_H))
new_img.paste(crisp_img, (0, 0))

sample_h = int(H * 0.28)
floor_sample = crisp_img.crop((0, H - sample_h, W, H))

current_y = H
while current_y < new_H:
    paste_h = min(sample_h, new_H - current_y)
    flipped_sample = floor_sample.transpose(Image.FLIP_TOP_BOTTOM).crop((0, 0, W, paste_h))
    new_img.paste(flipped_sample, (0, current_y))
    current_y += paste_h

# Resize chuẩn 16:9 chất lượng cao 1920x1080
target_w = 1920
target_h = int(target_w * 9 / 16)
final_img = new_img.resize((target_w, target_h), Image.Resampling.LANCZOS)

final_sharp = ImageEnhance.Sharpness(final_img).enhance(1.25)
final_sharp.save(output_path, quality=98)
print(SUCCESS: Image processed and saved to, output_path)
