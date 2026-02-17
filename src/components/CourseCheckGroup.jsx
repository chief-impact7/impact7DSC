import { memo } from 'react';
import { toast } from 'sonner';

const STATUS_CYCLE = [null, 'o', 'triangle', 'x'];

/** 숙제/리텐션 체크 그룹 */
const CourseCheckGroup = memo(function CourseCheckGroup({
    student,
    step,
    areas,
    isNext,
    onUpdate,
    readOnly,
    validate1stCheck,
}) {
    const data = student.checks?.[step] || {};

    return (
        <div className="flex justify-center gap-1" onClick={e => e.stopPropagation()}>
            {areas.map(area => {
                const status = data[area.key];
                let bg = 'bg-zinc-100 text-zinc-300';
                if (isNext) {
                    if (status) bg = 'bg-[#84994F] text-white';
                } else {
                    if (status === 'o')             bg = 'bg-[#84994F] text-white';
                    else if (status === 'triangle') bg = 'bg-[#FCB53B] text-white';
                    else if (status === 'x')        bg = 'bg-[#B45253] text-white';
                }

                return (
                    <button
                        key={area.key}
                        onClick={() => {
                            if (readOnly) {
                                toast.warning('이 뷰에서는 입력이 허용되지 않습니다.');
                                return;
                            }
                            if (step.endsWith('2') && validate1stCheck && !validate1stCheck(student)) {
                                toast.warning('1st 단계가 완료되지 않았습니다. 먼저 1st 단계를 입력해주세요.');
                                return;
                            }
                            if (isNext) {
                                onUpdate(area.key, status ? null : 'o');
                            } else {
                                const idx  = STATUS_CYCLE.indexOf(status || null);
                                const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
                                onUpdate(area.key, next);
                            }
                        }}
                        className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black transition-all ${bg} hover:brightness-95 ${readOnly ? 'cursor-not-allowed opacity-80' : ''}`}
                    >
                        {area.label}
                    </button>
                );
            })}
        </div>
    );
});

export default CourseCheckGroup;
