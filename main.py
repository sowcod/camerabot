#-*- coding: utf-8 -*-

import cv2
import json
import urllib.request
import time
import threading
import datetime
import subprocess

from flask import Flask, Response, jsonify
from google.cloud import storage

from PIL import Image, ImageFont, ImageDraw

app = Flask(__name__)

def resize_full(image:Image, w:int, h:int) -> Image:
    # はみ出ないようにリサイズ。ただし大きくはしない。
    if image.width / image.height > w / h:
        # 横がはみ出る場合、横幅を基準にスケール設定
        scale = w / image.width
    else:
        scale = h / image.height

    if scale > 0:
        scale = 1
    new_width = int(image.width * scale)
    new_height = int(image.height * scale)
    return image.resize((new_width, new_height), resample = Image.LANCZOS)

def resize_overflow(image:Image, w:int, h:int) -> Image:
    # 指定サイズにリサイズ。はみ出す。
    if image.width / image.height > w / h:
        # 横がはみ出る場合、縦幅を基準にスケール設定
        scale = h / image.height
    else:
        scale = w / image.width

    box_width = w / scale
    box_height = h / scale
    box_x = (image.width - box_width) / 2
    box_y = (image.height - box_height) / 2
    box = (int(box_x), int(box_y), int(box_x + box_width), int(box_y + box_height))
    return image.resize((w, h), resample = Image.LANCZOS, box = box)

def capture(original_filename, preview_filename):
    cap = cv2.VideoCapture(0)

    ret, frame = cap.read()
    if ret == True:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        orgImage = Image.fromarray(rgb_frame)
        resize_full(orgImage, 1024, 1024).save(original_filename, 'jpeg')
        resize_overflow(orgImage, 240, 240).save(preview_filename, 'jpeg')

    cap.release()

def upload_jpeg(remote_filename, local_filename):
    storage_client = storage.Client()
    bucket_name = 'camerabot_img'
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(remote_filename)
    blob.upload_from_filename(local_filename, 'image/jpeg')

    url = blob.public_url

    return url

def gen_post_request(url, data):
    headers = {
        'Content-Type': 'application/json'
    }
    return urllib.request.Request(url, json.dumps(data).encode('utf-8'), headers)

def set_webhook() :
    url = 'https://us-central1-mines-mines.cloudfunctions.net/camera_bot_talk'
    req = gen_post_request(url, {
            'mode': 'set_webhook',
            'port': 8089,
            'path': '/'
        })

    with urllib.request.urlopen(req) as res:
        pass

def unset_webhook() :
    url = 'https://us-central1-mines-mines.cloudfunctions.net/camera_bot_talk'
    req = gen_post_request(url, {
            'mode': 'unset_webhook',
        })

    with urllib.request.urlopen(req) as res:
        pass

def cafeinate():
    subprocess.run(['caffeinate', '-i'])

def run_server():
    app.run(host='0.0.0.0', port=8089)

@app.route('/')
def default():
    print('default call')
    try:
        capture('original.jpg', 'preview.jpg')
    except :
        return jsonify({
            'status': 'NG',
            'message': 'カメラキャプチャに失敗しました'
        })

    timestr = datetime.datetime.now().strftime(r'%Y%m%d%H%M%S%f')
    original_url = upload_jpeg(f'original_{timestr}.jpg', 'original.jpg')
    preview_url = upload_jpeg(f'preview_{timestr}.jpg', 'preview.jpg')
    # returns { original, preview }
    ret = {
        'status': 'OK',
        'original': original_url,
        'preview': preview_url
    }

    return jsonify(ret)

@app.route('/test')
def test():
    print('test call')
    return 'Test OK'


def setup_webhook():
    set_webhook()

if __name__ == '__main__':
    # capture()

    threading.Thread(target = lambda: setup_webhook()).start()
    threading.Thread(target = lambda: cafeinate()).start()

    run_server()


