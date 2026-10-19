/** Source-only Markdown context. Headings describe sections, never work items. */
export function hasUnspecifiedOtherProject(text: string) {
  return /(?:另一个|另一(?:个)?|其他)[\p{Script=Han}A-Za-z0-9]{0,12}项目/u.test(
    text,
  );
}

/** Only unqualified completed facts; mixed plans retain their own status. */
export function isCompletedMeetingFact(text: string) {
  return (
    /已(?:经)?(?:完成|上线|交付|验收|接入|发送|解决|修复)/.test(text) &&
    !/未|尚|待|需|计划|准备|预计|基本|部分|继续|后续|明天|下周|月底|如果|若|假如|一旦|到货后|完成后/.test(
      text,
    )
  );
}

/** Current-state facts do not create new tasks. Explicit plans remain separate. */
export function meetingFactStatus(
  text: string,
): "done" | "blocked" | "in_progress" | undefined {
  if (/如果|假如|一旦|若/.test(text)) return undefined;
  if (isCompletedMeetingFact(text)) return "done";
  if (
    /计划|准备|预计|后续|下一步|下周|明天|月底|需(?:要|继续|尽快|确认)|仍需|还需|现场需|到货后|完成后/.test(
      text,
    )
  )
    return undefined;
  if (/尚未回复|等待|等候|阻塞|受阻|无法|仍待/.test(text)) return "blocked";
  if (/正在|进行中|同步推进|尚未|仍未|未全部|部分完成|基本完成/.test(text))
    return "in_progress";
  return undefined;
}

/** Split only an evidenced fact followed by an explicit next action. */
export function splitMeetingFollowup(text: string) {
  const boundary =
    /[，,；;。]\s*(?=(?:后续|下一步|下周|明天|本周继续|现场需|需继续|仍需|还需|计划本周|厂家计划|设备到货后|需尽快|需要进一步|但[^，,；;。]{0,40}仍需))/g;
  for (const match of text.matchAll(boundary)) {
    const fact = text.slice(0, match.index).trim();
    if (/如果|假如|一旦|若|预计|计划/.test(fact)) continue;
    if (!/已|正在|尚未|仍未|基本完成|存在|较旧/.test(fact)) continue;
    const followup = text.slice(match.index + match[0].length).trim();
    if (!followup || /取消|无需|不再|暂不/.test(followup)) continue;
    return { fact, followup };
  }
  return null;
}

export function meetingSections(source: string) {
  let heading = "";
  return source.split(/\r?\n/).map((text, index) => {
    const match = text.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      heading =
        match[1]!.length >= 3
          ? match[2]!.replace(/^\d+[.、)）]\s*/, "").trim()
          : "";
    }
    return { text, sourceLine: index + 1, heading, isHeading: !!match };
  });
}
