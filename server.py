import os
import json
import time
import socket
from aiohttp import web

rooms = {}
public_path = os.path.join(os.path.dirname(__file__), 'public')

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def get_master_time(room):
    pb = room['playback']
    if pb['isPlaying']:
        return pb['currentTime'] + (time.time() - pb['updatedAt'])
    return pb['currentTime']

async def broadcast(room, message, exclude=None):
    payload = json.dumps(message)
    for client_ws in list(room['participants'].keys()):
        if client_ws != exclude and not client_ws.closed:
            try:
                await client_ws.send_str(payload)
            except Exception:
                pass

async def handle_index(request):
    return web.FileResponse(os.path.join(public_path, 'index.html'))

async def handle_info(request):
    return web.json_response({'ip': get_local_ip(), 'port': 5000})

async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=15)
    await ws.prepare(request)

    current_room_code = None
    user_id = None

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                action = data.get('type')

                if action == 'join':
                    current_room_code = str(data.get('room', 'main')).upper().strip()
                    user_name = str(data.get('name', 'Guest')).strip() or 'Guest'
                    user_id = f"user_{int(time.time() * 1000) % 100000}"

                    if current_room_code not in rooms:
                        rooms[current_room_code] = {
                            'host_ws': ws,
                            'host_id': user_id,
                            'participants': {},
                            'playback': {
                                'videoUrl': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
                                'title': 'Tears of Steel',
                                'isPlaying': False,
                                'currentTime': 0.0,
                                'updatedAt': time.time()
                            },
                            'playlist': [],
                            'chat': [],
                            'poll': None
                        }

                    room = rooms[current_room_code]
                    is_host = (room['host_ws'] == ws) or (len(room['participants']) == 0)
                    if is_host:
                        room['host_ws'] = ws
                        room['host_id'] = user_id

                    room['participants'][ws] = {
                        'id': user_id,
                        'name': user_name,
                        'isHost': is_host
                    }

                    master_time = get_master_time(room)

                    await ws.send_json({
                        'type': 'room_state',
                        'room': current_room_code,
                        'userId': user_id,
                        'userName': user_name,
                        'isHost': is_host,
                        'playback': {
                            'videoUrl': room['playback']['videoUrl'],
                            'title': room['playback']['title'],
                            'isPlaying': room['playback']['isPlaying'],
                            'currentTime': master_time,
                            'serverTime': time.time()
                        },
                        'participants': list(room['participants'].values()),
                        'playlist': room['playlist'],
                        'chat': room['chat'][-50:],
                        'poll': room['poll']
                    })

                    await broadcast(room, {
                        'type': 'user_joined',
                        'user': {'id': user_id, 'name': user_name, 'isHost': is_host},
                        'participants': list(room['participants'].values())
                    }, exclude=ws)

                elif action == 'play' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    client_time = float(data.get('currentTime', 0.0))
                    room['playback']['isPlaying'] = True
                    room['playback']['currentTime'] = client_time
                    room['playback']['updatedAt'] = time.time()

                    await broadcast(room, {
                        'type': 'play',
                        'currentTime': client_time,
                        'serverTime': time.time(),
                        'triggeredBy': room['participants'].get(ws, {}).get('name', 'Someone')
                    }, exclude=ws)

                elif action == 'pause' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    client_time = float(data.get('currentTime', 0.0))
                    room['playback']['isPlaying'] = False
                    room['playback']['currentTime'] = client_time
                    room['playback']['updatedAt'] = time.time()

                    await broadcast(room, {
                        'type': 'pause',
                        'currentTime': client_time,
                        'serverTime': time.time(),
                        'triggeredBy': room['participants'].get(ws, {}).get('name', 'Someone')
                    }, exclude=ws)

                elif action == 'seek' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    client_time = float(data.get('currentTime', 0.0))
                    room['playback']['currentTime'] = client_time
                    room['playback']['updatedAt'] = time.time()

                    await broadcast(room, {
                        'type': 'seek',
                        'currentTime': client_time,
                        'isPlaying': room['playback']['isPlaying'],
                        'serverTime': time.time(),
                        'triggeredBy': room['participants'].get(ws, {}).get('name', 'Someone')
                    }, exclude=ws)

                elif action == 'change_video' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    video_url = data.get('videoUrl')
                    title = data.get('title', 'Custom Video')
                    room['playback']['videoUrl'] = video_url
                    room['playback']['title'] = title
                    room['playback']['currentTime'] = 0.0
                    room['playback']['isPlaying'] = True
                    room['playback']['updatedAt'] = time.time()

                    await broadcast(room, {
                        'type': 'video_changed',
                        'videoUrl': video_url,
                        'title': title,
                        'currentTime': 0.0,
                        'isPlaying': True,
                        'serverTime': time.time(),
                        'triggeredBy': room['participants'].get(ws, {}).get('name', 'Someone')
                    })

                elif action == 'drift_ping' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    master_time = get_master_time(room)
                    await ws.send_json({
                        'type': 'drift_pong',
                        'masterTime': master_time,
                        'isPlaying': room['playback']['isPlaying'],
                        'clientPingTimestamp': data.get('pingTimestamp')
                    })

                elif action == 'chat' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    text = str(data.get('text', '')).strip()
                    if text:
                        user_info = room['participants'].get(ws, {'name': 'Anonymous'})
                        msg_item = {
                            'id': f"msg_{int(time.time() * 1000)}",
                            'userId': user_id,
                            'userName': user_info['name'],
                            'text': text[:300],
                            'time': time.strftime('%H:%M')
                        }
                        room['chat'].append(msg_item)
                        if len(room['chat']) > 100:
                            room['chat'].pop(0)

                        await broadcast(room, {
                            'type': 'chat_message',
                            'message': msg_item
                        })

                elif action == 'reaction' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    emoji = data.get('emoji', '❤️')
                    user_info = room['participants'].get(ws, {'name': 'Someone'})
                    await broadcast(room, {
                        'type': 'reaction',
                        'emoji': emoji,
                        'userName': user_info['name']
                    })

                elif action == 'playlist_add' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    item = {
                        'id': f"pl_{int(time.time() * 1000)}",
                        'title': data.get('title', 'Video'),
                        'videoUrl': data.get('videoUrl'),
                        'addedBy': room['participants'].get(ws, {}).get('name', 'User')
                    }
                    room['playlist'].append(item)
                    await broadcast(room, {
                        'type': 'playlist_updated',
                        'playlist': room['playlist']
                    })

                elif action == 'playlist_play' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    item_id = data.get('id')
                    target_item = next((x for x in room['playlist'] if x['id'] == item_id), None)
                    if target_item:
                        room['playlist'] = [x for x in room['playlist'] if x['id'] != item_id]
                        room['playback']['videoUrl'] = target_item['videoUrl']
                        room['playback']['title'] = target_item['title']
                        room['playback']['currentTime'] = 0.0
                        room['playback']['isPlaying'] = True
                        room['playback']['updatedAt'] = time.time()

                        await broadcast(room, {
                            'type': 'video_changed',
                            'videoUrl': target_item['videoUrl'],
                            'title': target_item['title'],
                            'currentTime': 0.0,
                            'isPlaying': True,
                            'serverTime': time.time(),
                            'triggeredBy': room['participants'].get(ws, {}).get('name', 'Someone')
                        })
                        await broadcast(room, {
                            'type': 'playlist_updated',
                            'playlist': room['playlist']
                        })

                elif action == 'create_poll' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    room['poll'] = {
                        'id': f"poll_{int(time.time() * 1000)}",
                        'question': data.get('question', 'What next?'),
                        'options': data.get('options', ['Yes', 'No']),
                        'votes': {}
                    }
                    await broadcast(room, {
                        'type': 'poll_updated',
                        'poll': room['poll']
                    })

                elif action == 'vote_poll' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    if room['poll']:
                        opt_idx = int(data.get('optionIndex', 0))
                        room['poll']['votes'][user_id] = opt_idx
                        await broadcast(room, {
                            'type': 'poll_updated',
                            'poll': room['poll']
                        })

                elif action == 'transfer_host' and current_room_code in rooms:
                    room = rooms[current_room_code]
                    target_user_id = data.get('targetUserId')
                    for p_ws, p_data in room['participants'].items():
                        if p_data['id'] == target_user_id:
                            room['host_ws'] = p_ws
                            room['host_id'] = target_user_id
                            p_data['isHost'] = True
                        else:
                            p_data['isHost'] = False

                    await broadcast(room, {
                        'type': 'host_transferred',
                        'newHostId': target_user_id,
                        'participants': list(room['participants'].values())
                    })

    finally:
        if current_room_code and current_room_code in rooms:
            room = rooms[current_room_code]
            departed = room['participants'].pop(ws, None)

            if len(room['participants']) == 0:
                rooms.pop(current_room_code, None)
            else:
                if room['host_ws'] == ws:
                    new_host_ws = next(iter(room['participants'].keys()))
                    room['host_ws'] = new_host_ws
                    room['host_id'] = room['participants'][new_host_ws]['id']
                    room['participants'][new_host_ws]['isHost'] = True

                await broadcast(room, {
                    'type': 'user_left',
                    'userId': user_id,
                    'userName': departed['name'] if departed else 'User',
                    'participants': list(room['participants'].values())
                })

    return ws

app = web.Application()
app.router.add_get('/', handle_index)
app.router.add_get('/ws', ws_handler)
app.router.add_get('/api/info', handle_info)
app.router.add_static('/', path=public_path)

if __name__ == '__main__':
    ip = get_local_ip()
    port = 5000
    print('==============================================')
    print('          WATCH PARTY SERVER RUNNING          ')
    print('==============================================')
    print(f'Local URL:   http://localhost:{port}/')
    print(f'Network URL: http://{ip}:{port}/')
    print('==============================================')
    web.run_app(app, host='0.0.0.0', port=port)
