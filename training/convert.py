import json, random

with open('training/data/calls.jsonl', encoding='utf-8') as f:
    lines = f.readlines()

converted = []
for line in lines:
    ex = json.loads(line)
    user_content = ex['messages'][0]['content']
    assistant = json.loads(ex['messages'][1]['content'])
    scores_clean = [{'parameter': s['parameter'], 'score': s['score']} for s in assistant['scores']]
    converted.append(json.dumps({
        'contents': [
            {'role': 'user',  'parts': [{'text': user_content}]},
            {'role': 'model', 'parts': [{'text': json.dumps({'scores': scores_clean})}]}
        ]
    }, ensure_ascii=False))

random.shuffle(converted)
split = int(len(converted) * 0.9)

with open('training/data/train_final.jsonl', 'w', encoding='utf-8') as f:
    f.write('\n'.join(converted[:split]))
with open('training/data/val_final.jsonl', 'w', encoding='utf-8') as f:
    f.write('\n'.join(converted[split:]))

print(f'Train: {split} | Val: {len(converted)-split}')
print('Saved to training/data/')
