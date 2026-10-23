import { onMount, type ComponentProps, splitProps } from "solid-js"

// Central Icons 1.1.315, round outlined, radius 2, stroke 1.5.
// https://www.npmjs.com/package/@central-icons-react/round-outlined-radius-2-stroke-1.5
const centralIcons = {
  "central-home": {
    viewBox: "0 0 24 24",
    body: `<path d="M3.75 9.7664C3.75 9.20923 3.75 8.93065 3.82009 8.67292C3.88218 8.44458 3.98431 8.22907 4.12172 8.03641C4.27681 7.81896 4.49242 7.64255 4.92364 7.28973L9.97364 3.15791C10.6956 2.56725 11.0565 2.27192 11.4583 2.15887C11.8125 2.05918 12.1875 2.05918 12.5417 2.15887C12.9435 2.27192 13.3044 2.56725 14.0264 3.15792L19.0764 7.28974C19.5076 7.64255 19.7232 7.81896 19.8783 8.03641C20.0157 8.22907 20.1178 8.44458 20.1799 8.67292C20.25 8.93065 20.25 9.20923 20.25 9.7664V17.05C20.25 18.1701 20.25 18.7301 20.032 19.158C19.8403 19.5343 19.5343 19.8403 19.158 20.032C18.7302 20.25 18.1701 20.25 17.05 20.25H6.95C5.82989 20.25 5.26984 20.25 4.84202 20.032C4.46569 19.8403 4.15973 19.5343 3.96799 19.158C3.75 18.7301 3.75 18.1701 3.75 17.05V9.7664Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  "central-agents": {
    viewBox: "0 0 24 24",
    body: `<circle cx="6" cy="5" r="2.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="19" r="2.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.4142 10.5858L10.5858 10.4142C11.3668 9.63316 12.6332 9.63317 13.4142 10.4142L13.5858 10.5858C14.3668 11.3668 14.3668 12.6332 13.5858 13.4142L13.4142 13.5858C12.6332 14.3668 11.3668 14.3668 10.5858 13.5858L10.4142 13.4142C9.63316 12.6332 9.63317 11.3668 10.4142 10.5858Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 5H16.75C18.683 5 20.25 6.567 20.25 8.5C20.25 10.433 18.683 12 16.75 12H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 12H7.25C5.317 12 3.75 13.567 3.75 15.5C3.75 17.433 5.317 19 7.25 19H15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-agent-skills": {
    viewBox: "0 0 24 24",
    body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M4 4.75C4 3.23122 5.23122 2 6.75 2H19.25C19.6642 2 20 2.33579 20 2.75V21.25C20 21.6642 19.6642 22 19.25 22H6.75C5.23122 22 4 20.7688 4 19.25C4 19.1948 4.00163 19.14 4.00483 19.0856C4.00164 19.0575 4 19.0289 4 19V4.75ZM5.5 19.25C5.5 19.9404 6.05964 20.5 6.75 20.5H18.5V18H6.75C6.05964 18 5.5 18.5596 5.5 19.25ZM18.5 16.5H6.75C6.29989 16.5 5.87503 16.6081 5.5 16.7999V4.75C5.5 4.05964 6.05964 3.5 6.75 3.5H18.5V16.5Z" fill="currentColor"/><path d="M12.1845 7.40787C12.2813 7.35949 12.3598 7.28103 12.4081 7.18426L13.0531 5.89443C13.2373 5.5259 13.7632 5.5259 13.9475 5.89443L14.5924 7.18426C14.6408 7.28103 14.7192 7.35949 14.816 7.40787L16.1058 8.05279C16.4744 8.23705 16.4744 8.76295 16.1058 8.94721L14.816 9.59213C14.7192 9.64051 14.6408 9.71897 14.5924 9.81574L13.9475 11.1056C13.7632 11.4741 13.2373 11.4741 13.0531 11.1056L12.4081 9.81574C12.3598 9.71897 12.2813 9.64051 12.1845 9.59213L10.8947 8.94721C10.5262 8.76295 10.5262 8.23705 10.8947 8.05279L12.1845 7.40787Z" fill="currentColor"/><path d="M8.5775 11.7114C8.63556 11.6824 8.68263 11.6353 8.71166 11.5772L9.23194 10.5367C9.3425 10.3155 9.65804 10.3155 9.7686 10.5367L10.2889 11.5772C10.3179 11.6353 10.365 11.6824 10.423 11.7114L11.4636 12.2317C11.6847 12.3422 11.6847 12.6578 11.4636 12.7683L10.423 13.2886C10.365 13.3176 10.3179 13.3647 10.2889 13.4228L9.7686 14.4633C9.65804 14.6845 9.3425 14.6845 9.23195 14.4633L8.71166 13.4228C8.68263 13.3647 8.63556 13.3176 8.5775 13.2886L7.53693 12.7683C7.31582 12.6578 7.31581 12.3422 7.53693 12.2317L8.5775 11.7114Z" fill="currentColor"/>`,
  },
  "central-files": {
    viewBox: "0 0 24 24",
    body: `<path d="M9.75 2.75H14.4216C14.952 2.75 15.4607 2.96071 15.8358 3.33579L19.6642 7.16421C20.0393 7.53929 20.25 8.04799 20.25 8.57843V16.25C20.25 17.3546 19.3546 18.25 18.25 18.25H9.75C8.64543 18.25 7.75 17.3546 7.75 16.25V4.75C7.75 3.64543 8.64543 2.75 9.75 2.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.25 18.25V19.25C17.25 20.3546 16.3546 21.25 15.25 21.25H6.75C5.64543 21.25 4.75 20.3546 4.75 19.25V7.75C4.75 6.64543 5.64543 5.75 6.75 5.75H7.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.25 2.75V5.75C15.25 6.85457 16.1454 7.75 17.25 7.75H20.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-user-group": {
    viewBox: "0 0 24 24",
    body: `<circle cx="12" cy="8.75" r="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="9.80005" r="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="9.80005" r="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.25 16.625V16.5C7.25 13.8766 9.37665 11.75 12 11.75C14.6234 11.75 16.75 13.8766 16.75 16.5V16.625C16.75 17.5225 16.0225 18.25 15.125 18.25H8.875C7.97754 18.25 7.25 17.5225 7.25 16.625Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.25 17.2602H2.75C1.64543 17.2602 0.706551 16.3538 0.919944 15.2701C1.25877 13.5493 2.15049 12.3257 4 11.8301" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.75 17.2601H21.25C22.3546 17.2601 23.2935 16.3538 23.08 15.27C22.7412 13.5493 21.8495 12.3257 20 11.8301" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-mcp": {
    viewBox: "0 0 24 24",
    body: `<path d="M11.0533 2.79347C12.4449 1.40182 14.7017 1.40188 16.0933 2.79347L16.2193 2.92628C16.9519 3.73696 17.2448 4.80308 17.1002 5.81886C18.1172 5.67274 19.1848 5.96602 19.9966 6.69972L20.1294 6.82569L20.1714 6.86769L20.2974 7.0005C21.5615 8.3994 21.5197 10.5595 20.1714 11.9077L12.8785 19.2007C12.786 19.2935 12.7858 19.444 12.8785 19.5366L14.3755 21.0337C14.6538 21.312 14.6538 21.7632 14.3755 22.0415C14.0972 22.3196 13.646 22.3198 13.3677 22.0415L11.8707 20.5444C11.2213 19.8951 11.2215 18.8423 11.8707 18.1929L19.1627 10.8999C19.9456 10.1171 19.9952 8.87744 19.3101 8.03761L19.1627 7.8755L19.1207 7.83351C18.2856 6.99932 16.932 6.99885 16.0972 7.83351L10.0914 13.8394C10.085 13.8458 10.0765 13.8499 10.0699 13.856L10.0035 13.9234C9.72519 14.2014 9.27393 14.2014 8.99566 13.9234C8.71756 13.6451 8.71763 13.1939 8.99566 12.9155L15.0855 6.82569C15.9205 5.99069 15.9205 4.63629 15.0855 3.80128C14.2505 2.96644 12.8961 2.96629 12.0611 3.80128L3.99761 11.8648C3.71926 12.143 3.2681 12.1431 2.9898 11.8648C2.71179 11.5864 2.71167 11.1352 2.9898 10.8569L11.0533 2.79347Z" fill="currentColor"/><path d="M13.0777 4.80909C13.356 4.53092 13.8072 4.53098 14.0855 4.80909C14.3638 5.0874 14.3637 5.53856 14.0855 5.81691L8.12164 11.7808C7.28687 12.6156 7.28712 13.9691 8.12164 14.8042C8.95667 15.6392 10.311 15.6392 11.146 14.8042L17.1099 8.84132C17.3882 8.56315 17.8394 8.56321 18.1177 8.84132C18.3956 9.11965 18.3958 9.57091 18.1177 9.84913L12.1539 15.813C10.7622 17.2045 8.50553 17.2044 7.11382 15.813C5.72238 14.4213 5.72225 12.1646 7.11382 10.773L13.0777 4.80909Z" fill="currentColor"/>`,
  },
  "central-plus-small": {
    viewBox: "0 0 24 24",
    body: `<path d="M12 6.75V12M12 12V17.25M12 12H6.75M12 12H17.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  "central-search": {
    viewBox: "0 0 24 24",
    body: `<path d="M20.25 20.25L16.1265 16.1265M16.1265 16.1265C17.4385 14.8145 18.25 13.002 18.25 11C18.25 6.99594 15.0041 3.75 11 3.75C6.99594 3.75 3.75 6.99594 3.75 11C3.75 15.0041 6.99594 18.25 11 18.25C13.002 18.25 14.8145 17.4385 16.1265 16.1265Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-chevron-right-small": {
    viewBox: "0 0 24 24",
    body: `<path d="M10 16L13.2929 12.7071C13.6834 12.3166 13.6834 11.6834 13.2929 11.2929L10 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-chevron-down-small": {
    viewBox: "0 0 24 24",
    body: `<path d="M8 10L11.2929 13.2929C11.6834 13.6834 12.3166 13.6834 12.7071 13.2929L16 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-arrow-left": {
    viewBox: "0 0 24 24",
    body: `<path d="M10 5.75L3.75 12L10 18.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 12H20.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-folder-closed": {
    viewBox: "0 0 24 24",
    body: `<path d="M2.75 5.75V17.25C2.75 18.3546 3.64543 19.25 4.75 19.25H19.25C20.3546 19.25 21.25 18.3546 21.25 17.25V8.75C21.25 7.64543 20.3546 6.75 19.25 6.75H13.0704C12.4017 6.75 11.7772 6.4158 11.4063 5.8594L10.5937 4.6406C10.2228 4.0842 9.59834 3.75 8.92963 3.75H4.75C3.64543 3.75 2.75 4.64543 2.75 5.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-folder-open": {
    viewBox: "0 0 24 24",
    body: `<path d="M4.75 3.75H8.92963C9.59834 3.75 10.2228 4.0842 10.5937 4.6406L11.7031 6.3047C11.8886 6.5829 12.2008 6.75 12.5352 6.75H18.25C19.3546 6.75 20.25 7.64543 20.25 8.75V10.75H20.6635C21.3311 10.75 21.8113 11.3917 21.6229 12.0322L19.9223 17.8143C19.6719 18.6655 18.8907 19.25 18.0035 19.25H4.32301C3.45426 19.25 2.75 18.5457 2.75 17.677V5.75C2.75 4.64543 3.64543 3.75 4.75 3.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.2493 10.75H9.49573C8.60851 10.75 7.82734 11.3345 7.577 12.1857L5.83136 18.1208C5.63446 18.7903 5.02007 19.25 4.32227 19.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-clock": {
    viewBox: "0 0 24 24",
    body: `<circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.75V12L15 14.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-sessions": {
    viewBox: "0 0 24 24",
    body: `<path d="M15.5 21.25C12.3244 21.25 9.75 18.8995 9.75 16C9.75 13.1005 12.3244 10.75 15.5 10.75C18.6756 10.75 21.25 13.1005 21.25 16C21.25 16.8655 21.0206 17.6821 20.6144 18.4018C20.3182 18.9264 20.1287 19.5306 20.3105 20.105C20.3994 20.3859 20.501 20.6641 20.6111 20.9412C20.0861 20.9099 19.5813 20.8467 19.0901 20.7502C18.5969 20.6535 18.0862 20.7133 17.6135 20.884C16.9592 21.1202 16.2462 21.25 15.5 21.25Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.25161 15.7481C7.21959 15.7359 7.18768 15.7235 7.15589 15.7108C6.68047 15.5219 6.15944 15.4613 5.65929 15.5689C4.98147 15.7147 4.284 15.8087 3.55556 15.8529C3.72946 15.4065 3.88674 14.9579 4.01651 14.5031C4.17927 13.9326 4.00163 13.3369 3.69255 12.8306C3.09262 11.8478 2.75 10.7112 2.75 9.5C2.75 5.77208 5.99594 2.75 10 2.75C13.5468 2.75 16.4987 5.12118 17.1267 8.25375" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-api-connection": {
    viewBox: "0 0 24 24",
    body: `<path d="M3.75 12C3.75 16.5563 7.44365 20.25 12 20.25C15.498 20.25 18.4875 18.073 19.6876 15M3.75 12C3.75 7.44365 7.44365 3.75 12 3.75C15.498 3.75 18.4875 5.92698 19.6876 9M3.75 12H1.75M17.25 12C17.25 14.8995 14.8995 17.25 12 17.25C9.10051 17.25 6.75 14.8995 6.75 12C6.75 9.10051 9.10051 6.75 12 6.75C14.8995 6.75 17.25 9.10051 17.25 12ZM17.25 12H22.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-rocket": {
    viewBox: "0 0 24 24",
    body: `<path d="M12.9477 21.25H11.0568C10.364 21.25 9.71507 20.8924 9.3715 20.2909C5.70662 13.8742 5.62412 8.13584 12.0022 2.75C18.3804 8.13584 18.2978 13.8742 14.633 20.2909C14.2894 20.8924 13.6404 21.25 12.9477 21.25Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.85915 10.9385L4.17344 14.5194C3.91379 14.8656 3.77344 15.2867 3.77344 15.7194V18.1956C3.77344 19.3002 4.66887 20.1956 5.77344 20.1956H8.91629" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.1431 10.9385L19.8288 14.5194C20.0884 14.8656 20.2288 15.2867 20.2288 15.7194V18.1956C20.2288 19.3002 19.3334 20.1956 18.2288 20.1956H15.0859" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.5" stroke="currentColor" stroke-width="1.54286" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-wallet": {
    viewBox: "0 0 24 24",
    body: `<path d="M2.75 7.75V6.75C2.75 5.64543 3.64543 4.75 4.75 4.75H19.25C20.3546 4.75 21.25 5.64543 21.25 6.75V7.75M2.75 7.75H21.25M2.75 7.75V10.75M21.25 7.75V10.75M21.25 10.75V17.25C21.25 18.3546 20.3546 19.25 19.25 19.25H4.75C3.64543 19.25 2.75 18.3546 2.75 17.25V10.75M21.25 10.75H15.25V11.25C15.25 12.3546 14.3546 13.25 13.25 13.25H10.75C9.64543 13.25 8.75 12.3546 8.75 11.25V10.75H2.75" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  "central-key-1": {
    viewBox: "0 0 24 24",
    body: `<path d="M1.75 12C1.75 14.8995 4.10051 17.25 7 17.25C8.69095 17.25 10.1952 16.4506 11.1554 15.2091C11.3677 14.9345 11.6844 14.75 12.0315 14.75H13.7132C13.9006 14.75 14.0843 14.6973 14.2432 14.598L15.47 13.8312C15.7943 13.6286 16.2057 13.6286 16.53 13.8312L17.7568 14.598C17.9157 14.6973 18.0994 14.75 18.2868 14.75H20.0261C20.3261 14.75 20.6101 14.6154 20.8001 14.3832L22.2319 12.6332C22.5333 12.2649 22.5333 11.7351 22.2319 11.3668L20.8001 9.61676C20.6101 9.38463 20.3261 9.25 20.0261 9.25H12.0315C11.6844 9.25 11.3677 9.06549 11.1554 8.79095C10.1952 7.54942 8.69095 6.75 7 6.75C4.10051 6.75 1.75 9.10051 1.75 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.75 12C7.75 12.4142 7.41421 12.75 7 12.75C6.58579 12.75 6.25 12.4142 6.25 12C6.25 11.5858 6.58579 11.25 7 11.25C7.41421 11.25 7.75 11.5858 7.75 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  "central-list-bullets": {
    viewBox: "0 0 24 24",
    body: `<path d="M8.75 6L20.25 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="4.2" cy="5.9998" r="1.2" fill="currentColor"/><path d="M8.75 12L20.25 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="4.2" cy="11.9998" r="1.2" fill="currentColor"/><path d="M8.75 18L20.25 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="4.2" cy="17.9998" r="1.2" fill="currentColor"/>`,
  },
  "central-checkmark-small": {
    viewBox: "0 0 24 24",
    body: `<path d="M7.75 13.0625L10.9375 16.25L16.25 7.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "central-horizontal-dots": {
    viewBox: "0 0 24 24",
    body: `<rect x="3" y="10" width="4" height="4" rx="2" fill="currentColor"/><rect x="10" y="10" width="4" height="4" rx="2" fill="currentColor"/><rect x="17" y="10" width="4" height="4" rx="2" fill="currentColor"/>`,
  },
  "central-theme": {
    viewBox: "0 0 24 24",
    body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12 20.5C16.6944 20.5 20.5 16.6944 20.5 12C20.5 7.30558 16.6944 3.5 12 3.5V20.5ZM22 12C22 17.5228 17.5228 22 12 22C11.7275 22 11.4573 21.9891 11.19 21.9676C6.04558 21.5549 2 17.2502 2 12C2 6.74975 6.04558 2.44515 11.19 2.03237C11.4573 2.01092 11.7275 2 12 2C17.5228 2 22 6.47715 22 12Z" fill="currentColor"/>`,
  },
  "central-logout": {
    viewBox: "0 0 24 24",
    body: `<path d="M20.25 12L9 12M20.25 12L15.75 16.5M20.25 12L15.75 7.5M11.25 20.25H5.75C4.64543 20.25 3.75 19.3546 3.75 18.25L3.75 5.75C3.75 4.64543 4.64543 3.75 5.75 3.75L11.25 3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
} as const

const icons = {
  ...centralIcons,
  "circle-ban-sign": {
    viewBox: "0 0 24 24",
    body: `<circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5"/><path d="M5.459 5.459L18.541 18.541" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  console: {
    viewBox: "0 0 24 24",
    body: `<path d="M7.25 7.75L9 9.5L7.25 11.25M10.75 11.25H12.75M6.75 20.25H17.25C18.9069 20.25 20.25 18.9069 20.25 17.25V6.75C20.25 5.09315 18.9069 3.75 17.25 3.75H6.75C5.09315 3.75 3.75 5.09315 3.75 6.75V17.25C3.75 18.9069 5.09315 20.25 6.75 20.25Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "file-read": {
    viewBox: "0 0 24 24",
    body: `<path d="M19.3713 20.364C18.1997 21.5356 16.3003 21.5356 15.1287 20.364C13.9571 19.1924 13.9571 17.2929 15.1287 16.1214C16.3003 14.9498 18.1997 14.9498 19.3713 16.1214C20.5429 17.2929 20.5429 19.1924 19.3713 20.364Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.249 12.5V5.74512C19.249 4.08826 17.9059 2.74512 16.249 2.74512H6.75394C5.09709 2.74512 3.75395 4.08826 3.75394 5.74511L3.75391 18.2461C3.7539 19.9029 5.09705 21.2461 6.75391 21.2461H11.999" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 14.75H9.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 6.75H15.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 10.75H11.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.3711 20.3638L21.2498 22.2425" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "file-edit": {
    viewBox: "0 0 24 24",
    body: `<path d="M10.75 21.25H7.75C6.09315 21.25 4.75 19.9069 4.75 18.25V5.75C4.75 4.09315 6.09315 2.75 7.75 2.75H16.25C17.9069 2.75 19.25 4.09315 19.25 5.75V11.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.75 21.2502V18.9168L17.5 15.1668C18.1443 14.5225 19.189 14.5225 19.8333 15.1668C20.4777 15.8112 20.4777 16.8558 19.8333 17.5002L16.0833 21.2502H13.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round"/><path d="M8.75 6.75H15.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.75 10.75H11.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  web: {
    viewBox: "0 0 24 24",
    body: `<path d="M19.7783 4.22184L4.22197 19.7782M21.25 12C21.25 17.1086 17.1086 21.25 12 21.25C6.89137 21.25 2.75 17.1086 2.75 12C2.75 6.89137 6.89137 2.75 12 2.75C17.1086 2.75 21.25 6.89137 21.25 12ZM18.5163 18.516C17.3167 19.7156 13.427 17.7707 9.82826 14.172C6.22955 10.5733 4.28467 6.68352 5.48424 5.48395C6.68381 4.28438 10.5736 6.22927 14.1723 9.82798C17.771 13.4267 19.7159 17.3165 18.5163 18.516Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  home: {
    viewBox: "0 0 16 16",
    body: `<path d="M2 7.25L8 2L14 7.25V14H9.75V9.75H6.25V14H2V7.25Z" stroke="currentColor" stroke-linejoin="round"/>`,
  },
  edit: {
    viewBox: "0 0 24 24",
    body: `<path d="M12.75 11.25V8.24998L17.25 3.74998C18.0784 2.92156 19.4216 2.92156 20.25 3.74998C21.0784 4.57841 21.0784 5.92155 20.25 6.74998L15.75 11.25H12.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.25 3.75H8.55C6.86984 3.75 6.02976 3.75 5.38803 4.07698C4.82354 4.3646 4.3646 4.82354 4.07698 5.38803C3.75 6.02976 3.75 6.86984 3.75 8.55V15.45C3.75 17.1302 3.75 17.9702 4.07698 18.612C4.3646 19.1765 4.82354 19.6354 5.38803 19.923C6.02976 20.25 6.86984 20.25 8.55 20.25H15.45C17.1302 20.25 17.9702 20.25 18.612 19.923C19.1765 19.6354 19.6354 19.1765 19.923 18.612C20.25 17.9702 20.25 17.1302 20.25 15.45V12.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "folder-add-left": {
    viewBox: "0 0 16 16",
    body: `<path d="M7.5 13.3333H1.5V2H6.83333L8.83333 4H14.8333V6M10.1667 11.3333H15.5M12.8333 8.66667V14" stroke="currentColor" stroke-miterlimit="10" stroke-linecap="square"/>`,
  },
  folder: {
    viewBox: "0 0 16 16",
    body: `<path d="M2.545 3.364V12.636H13.455V5H8.545L6.909 3.364H2.545Z" stroke="currentColor" stroke-miterlimit="10" stroke-linecap="square"/>`,
  },
  branch: {
    viewBox: "0 0 16 16",
    body: `<path d="M5.118 5.686V10.314M5.118 5.686C5.97 5.686 6.661 4.995 6.661 4.143C6.661 3.291 5.97 2.6 5.118 2.6C4.266 2.6 3.575 3.291 3.575 4.143C3.575 4.995 4.266 5.686 5.118 5.686ZM5.118 10.314C4.266 10.314 3.575 11.005 3.575 11.857C3.575 12.709 4.266 13.4 5.118 13.4C5.97 13.4 6.661 12.709 6.661 11.857M5.118 10.314C5.97 10.314 6.661 11.005 6.661 11.857M10.882 5.686C11.734 5.686 12.425 4.995 12.425 4.143C12.425 3.291 11.734 2.6 10.882 2.6C10.03 2.6 9.339 3.291 9.339 4.143C9.339 4.995 10.03 5.686 10.882 5.686ZM10.882 5.686V9.457C10.882 10.783 9.807 11.857 8.482 11.857H6.661" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "grid-plus": {
    viewBox: "0 0 16 16",
    body: `<path d="M13.9948 11.668H9.32812M11.6641 9.33203V13.9987M6.66667 9.33203V13.9987H2V9.33203H6.66667ZM6.66667 2V6.66667H2V2H6.66667ZM13.9948 2V6.66667H9.32812V2H13.9948Z" stroke="currentColor" stroke-miterlimit="10" stroke-linecap="square"/>`,
  },
  help: {
    viewBox: "0 0 16 16",
    body: `<path d="M6.33345 6.33349V5.00015H9.66679V7.00015L8.00015 8.00015V9.66679M8.27485 11.6819H7.71897M14.4446 8.00011C14.4446 11.5593 11.5593 14.4446 8.00011 14.4446C4.44094 14.4446 1.55566 11.5593 1.55566 8.00011C1.55566 4.44094 4.44094 1.55566 8.00011 1.55566C11.5593 1.55566 14.4446 4.44094 14.4446 8.00011Z" stroke="currentColor" stroke-linecap="square"/>`,
  },
  "sidebar-right": {
    viewBox: "0 0 24 24",
    body: `<path d="M15.75 5V19" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.75 6.75C2.75 5.64543 3.64543 4.75 4.75 4.75H19.25C20.3546 4.75 21.25 5.64543 21.25 6.75V17.25C21.25 18.3546 20.3546 19.25 19.25 19.25H4.75C3.64543 19.25 2.75 18.3546 2.75 17.25V6.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  "sidebar-left": {
    viewBox: "0 0 24 24",
    body: `<path d="M2.75 7.75C2.75 6.09315 4.09315 4.75 5.75 4.75H18.25C19.9069 4.75 21.25 6.09315 21.25 7.75V16.25C21.25 17.9069 19.9069 19.25 18.25 19.25H5.75C4.09315 19.25 2.75 17.9069 2.75 16.25V7.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.25 5V12V19" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  },
  status: {
    viewBox: "0 0 20 20",
    body: `<path d="M2 10V18H18V10M2 10V2H18V10M2 10H18M5 6H9M5 14H9" stroke="currentColor"/>`,
  },
  "status-active": {
    viewBox: "0 0 20 20",
    body: `<path d="M18 2H2V10H18V2Z" fill="currentColor" fill-opacity="0.1"/><path d="M2 18H18V10H2V18Z" fill="currentColor" fill-opacity="0.1"/><path d="M2 10V18H18V10M2 10V2H18V10M2 10H18M5 6H9M5 14H9" stroke="currentColor"/>`,
  },
  "magnifying-glass": {
    viewBox: "0 0 16 16",
    body: `<path d="M14 14L10.3454 10.3454M6.88889 11.7778C9.58889 11.7778 11.7778 9.58889 11.7778 6.88889C11.7778 4.18889 9.58889 2 6.88889 2C4.18889 2 2 4.18889 2 6.88889C2 9.58889 4.18889 11.7778 6.88889 11.7778Z" stroke="currentColor"/>`,
  },
  menu: {
    viewBox: "0 0 16 16",
    body: `<path d="M2 8H14M2 4.664H14M2 11.336H14" stroke="currentColor"/>`,
  },
  plus: {
    viewBox: "0 0 24 24",
    body: `<path d="M12 5.25V12M12 12V18.75M12 12H5.25M12 12H18.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  "settings-gear": {
    viewBox: "0 0 16 16",
    body: `<path d="M7.99998 1.3335L14 4.66683V11.3335L7.99998 14.6668L2 11.3335V4.66683L7.99998 1.3335Z" stroke="currentColor"/><path d="M9.99998 8.00016C9.99998 9.10476 9.10458 10.0002 7.99998 10.0002C6.89538 10.0002 5.99998 9.10476 5.99998 8.00016C5.99998 6.89556 6.89538 6.00016 7.99998 6.00016C9.10458 6.00016 9.99998 6.89556 9.99998 8.00016Z" stroke="currentColor"/>`,
  },
  "chevron-down": {
    viewBox: "0 0 16 16",
    body: `<path d="M5 6.5L8 9.5L11 6.5" stroke="currentColor"/>`,
  },
  "chevron-right": {
    viewBox: "0 0 16 16",
    body: `<path d="M6.5 5L9.5 8L6.5 11" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "arrow-left": {
    viewBox: "0 0 16 16",
    body: `<path d="M13 8H3M6.5 4.5L3 8L6.5 11.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "arrow-up": {
    viewBox: "0 0 24 24",
    body: `<path d="M12 20.25V4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.75 10L12 3.75L18.25 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  stop: {
    viewBox: "0 0 24 24",
    body: `<path d="M20.25 15.45V8.55C20.25 6.86984 20.25 6.02976 19.923 5.38803C19.6354 4.82354 19.1765 4.3646 18.612 4.07698C17.9702 3.75 17.1302 3.75 15.45 3.75H8.55C6.86984 3.75 6.02976 3.75 5.38803 4.07698C4.82354 4.3646 4.3646 4.82354 4.07698 5.38803C3.75 6.02976 3.75 6.86984 3.75 8.55V15.45C3.75 17.1302 3.75 17.9702 4.07698 18.612C4.3646 19.1765 4.82354 19.6354 5.38803 19.923C6.02976 20.25 6.86984 20.25 8.55 20.25H15.45C17.1302 20.25 17.9702 20.25 18.612 19.923C19.1765 19.6354 19.6354 19.1765 19.923 18.612C20.25 17.9702 20.25 17.1302 20.25 15.45Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  collapse: {
    viewBox: "0 0 16 16",
    body: `<path d="M8 1V6M11 3L8 6L5 3" stroke="currentColor"/><path d="M8 15V10M11 13L8 10L5 13" stroke="currentColor"/><path d="M4 8H6" stroke="currentColor"/><path d="M7 8H9" stroke="currentColor"/><path d="M10 8H12" stroke="currentColor"/>`,
  },
  check: {
    viewBox: "0 0 16 16",
    body: `<path d="M3.53613 8.17857L6.39328 11.75L12.4647 4.25" stroke="currentColor"/>`,
  },
  monitor: {
    viewBox: "0 0 16 16",
    body: `<path d="M4.05559 9.38889H0.500007C0.500007 9.38889 0.500017 8.59298 0.500017 7.61112V2.27778C0.500017 1.29594 0.500102 0.5 0.500102 0.5H13.3889C13.3889 0.5 13.3889 1.29594 13.3889 2.27778V7.61112C13.3889 8.59298 13.3889 9.38889 13.3889 9.38889H9.83336M4.05559 9.38889V11.6111H6.94448H9.83336V9.38889M4.05559 9.38889H9.83336" transform="translate(1.05556 1.94444)" stroke="currentColor"/>`,
  },
  "workspace-new": {
    viewBox: "0 0 16 16",
    body: `<path d="M2 10.7578V14.0011H5.24324M13.9991 5.24324V2H10.7559M13.9991 10.7578V14.0011H10.7559M2 5.24324V2H5.24324" stroke="currentColor" stroke-miterlimit="10" stroke-linecap="square"/><path d="M8 4.5V11.5M4.5 8H11.5" stroke="currentColor" stroke-linejoin="round"/>`,
  },
  "workspace-isolated": {
    viewBox: "0 0 16 16",
    body: `<path d="M10.5 10.5V5.5H5.5V10.5H10.5Z" fill="currentColor"/><rect x="2.5" y="2.5" width="11" height="11" stroke="currentColor"/>`,
  },
  workspace: {
    viewBox: "0 0 16 16",
    body: `<path d="M2 10.668V14.0013H10.6667M13.9974 10.6667V2H2.66406M13.9974 10.668V14.0013H10.6641M2 10V2H5.33333" stroke="currentColor" stroke-miterlimit="10" stroke-linecap="square"/><path d="M10.6693 10.6654V5.33203H5.33594V10.6654H10.6693Z" fill="currentColor"/>`,
  },
  close: {
    viewBox: "0 0 20 20",
    body: `<path d="M14.4446 5.55566L5.55566 14.4446M5.55566 5.55566L14.4446 14.4446" stroke="currentColor" stroke-linejoin="round"/>`,
  },
  "xmark-small": {
    viewBox: "0 0 16 16",
    body: `<path d="M4.25 11.75L11.75 4.25M11.75 11.75L4.25 4.25" stroke="currentColor"/>`,
  },
  "outline-xmark": {
    viewBox: "0 0 16 16",
    body: `<path fill-rule="evenodd" clip-rule="evenodd" d="M4.99487 5.70186L7.29297 7.99995L4.99487 10.2981L5.70198 11.0052L8.00008 8.70706L10.2982 11.0052L11.0053 10.2981L8.70718 7.99995L11.0053 5.70186L10.2982 4.99475L8.00008 7.29285L5.70198 4.99475L4.99487 5.70186Z" fill="currentColor"/>`,
  },
  "outline-chevron-down": {
    viewBox: "0 0 16 16",
    body: `<path d="M5 6.5L8 9.5L11 6.5" stroke="currentColor"/>`,
  },
  "outline-dots": {
    viewBox: "0 0 16 16",
    body: `<path d="M2.5 7.5H3.5V8.5H2.5V7.5Z" stroke="currentColor"/><path d="M7.5 7.5H8.5V8.5H7.5V7.5Z" stroke="currentColor"/><path d="M12.5 7.5H13.5V8.5H12.5V7.5Z" stroke="currentColor"/>`,
  },
  expand: {
    viewBox: "0 0 16 16",
    body: `<path d="M8.25 6.17773V1.17773M11.25 4.17773L8.25 1.17773L5.25 4.17773" stroke="currentColor"/><path d="M8.25 9.17773V14.1777M11.25 11.1777L8.25 14.1777L5.25 11.1777" stroke="currentColor"/><path d="M4.25 7.67773H12.25" stroke="currentColor"/>`,
  },
  filetree: {
    viewBox: "0 0 24 24",
    body: `<path d="M4.75 3.75V15.75C4.75 16.8546 5.64543 17.75 6.75 17.75H13.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.75 9.74994H6.75293C5.64836 9.74994 4.75293 8.85451 4.75293 7.74994V4.32324" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16.5" cy="17.75" r="2.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16.5" cy="9.75" r="2.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  split: {
    viewBox: "0 0 16 16",
    body: `<path d="M1 14H15L15 2H1V14Z" stroke="currentColor"/><rect x="3" y="4" width="4" height="8" fill="currentColor" fill-opacity="0.5"/><rect x="9" y="4" width="4" height="8" fill="currentColor" fill-opacity="0.5"/>`,
  },
  unified: {
    viewBox: "0 0 16 16",
    body: `<path d="M3.00001 4.00045L12.9998 4L13 6.99955L3 7L3.00001 4.00045Z" fill="currentColor" fill-opacity="0.5"/><path d="M3.0001 9H13L12.9999 12H3L3.0001 9Z" fill="currentColor" fill-opacity="0.5"/><path d="M1 14H15L15 2H1V14Z" stroke="currentColor"/>`,
  },
  review: {
    viewBox: "0 0 20 20",
    body: `<path d="M7 14.5H13M7 7.99512H10.0049M10.0049 7.99512H13M10.0049 7.99512V5M10.0049 7.99512V11M18 18V2L2 2L2 18H18Z" stroke="currentColor"/>`,
  },
  "outline-sliders": {
    viewBox: "0 0 16 16",
    body: `<path d="M11.7779 4.66675H14.4446M11.7779 4.66675C11.7779 5.77132 10.8825 6.66675 9.77789 6.66675C8.67332 6.66675 7.77789 5.77132 7.77789 4.66675M11.7779 4.66675C11.7779 3.56218 10.8825 2.66675 9.77789 2.66675C8.67332 2.66675 7.77789 3.56218 7.77789 4.66675M1.55566 4.66675H7.77789M4.22233 11.3334H1.55566M4.22233 11.3334C4.22233 12.438 5.11776 13.3334 6.22233 13.3334C7.3269 13.3334 8.22233 12.438 8.22233 11.3334M4.22233 11.3334C4.22233 10.2288 5.11776 9.33341 6.22233 9.33341C7.3269 9.33341 8.22233 10.2288 8.22233 11.3334M14.4446 11.3334H8.22233" stroke="currentColor"/>`,
  },
  sliders: {
    viewBox: "0 0 24 24",
    body: `<path d="M5.70117 20.254V14.0015" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.70117 10.25V3.74707" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 20.0038V12.7505" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8.99915V3.99707" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.2988 20.2536V16.002" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.2988 12.2508V3.74707" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 9.24902H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.25 15.752H20.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.74609 13.7515H7.74982" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "outline-copy": {
    viewBox: "0 0 16 16",
    body: `<path d="M4.14908 11.0081H1.76282V1.51758H9.1038V2.55588M14.2225 4.99681H6.75397V14.4873H14.2225V4.99681Z" stroke="currentColor"/>`,
  },
  "outline-square-arrow": {
    viewBox: "0 0 16 16",
    body: `<path d="M13.5555 6.66656V2.44434H9.33326M13.5555 2.44434L7.99993 7.99989M13.5555 9.33324V13.5555C13.5555 13.5555 12.7599 13.5555 11.7777 13.5555H2.44438C2.44438 13.5555 2.44438 12.7599 2.44438 11.7777V4.22213C2.44438 3.2399 2.44434 2.44435 2.44434 2.44435H6.66661" stroke="currentColor"/>`,
  },
  "outline-share": {
    viewBox: "0 0 16 16",
    body: `<path d="M13.5554 10.4445V13.5556C13.5554 13.5556 12.7599 13.5556 11.7777 13.5556H4.22211C3.23989 13.5556 2.44434 13.5556 2.44434 13.5556V10.4445M4.88878 5.55557L7.99989 2.44446L11.111 5.55557M7.99989 2.44446L7.99989 9.11112" stroke="currentColor"/>`,
  },
  reset: {
    viewBox: "0 0 20 20",
    body: `<path d="M5.83333 4.16406L2.5 7.4974L5.83333 10.8307M3.33333 7.4974H17.9167V15.4141H10" stroke="currentColor" stroke-linecap="square"/>`,
  },
  "outline-reset": {
    viewBox: "0 0 20 20",
    body: `<path d="M5.83333 4.16406L2.5 7.4974L5.83333 10.8307M3.33333 7.4974H17.9167V15.4141H10" stroke="currentColor" stroke-linecap="square"/>`,
  },
  archive: {
    viewBox: "0 0 16 16",
    body: `<path d="M13.1112 13.5555V14.0555H13.6112V13.5555H13.1112ZM2.889 13.5555H2.389L2.389 14.0555H2.889V13.5555ZM3.38901 5.55546L3.38901 5.05546L2.38901 5.05546L2.38901 5.55546L2.88901 5.55546L3.38901 5.55546ZM14.4446 2.44434H14.9446V1.94434L14.4446 1.94434L14.4446 2.44434ZM14.4446 5.55545L14.4446 6.05545L14.9446 6.05545V5.55545H14.4446ZM1.55566 5.55546L1.05566 5.55545L1.05566 6.05546L1.55566 6.05546L1.55566 5.55546ZM1.5557 2.44436L1.5557 1.94436L1.05571 1.94436L1.0557 2.44435L1.5557 2.44436ZM13.1112 5.55546H12.6112V13.5555H13.1112H13.6112V5.55546H13.1112ZM2.889 13.5555H3.389L3.38901 5.55546L2.88901 5.55546L2.38901 5.55546L2.389 13.5555H2.889ZM14.4446 2.44434H13.9446V5.55545H14.4446H14.9446V2.44434H14.4446ZM1.55566 5.55546L2.05566 5.55547L2.0557 2.44436L1.5557 2.44436L1.0557 2.44435L1.05566 5.55545L1.55566 5.55546ZM6.22234 8.22213V8.72213H9.7779V8.22213V7.72213H6.22234V8.22213ZM13.1112 13.5555V13.0555H2.889V13.5555V14.0555H13.1112V13.5555ZM1.5557 2.44436L1.5557 2.94436L14.4446 2.94434L14.4446 2.44434L14.4446 1.94434L1.5557 1.94436L1.5557 2.44436ZM14.4446 5.55545L14.4446 5.05545L1.55566 5.05546L1.55566 5.55546L1.55566 6.05546L14.4446 6.05545L14.4446 5.55545Z" fill="currentColor"/>`,
  },
  skill: {
    viewBox: "0 0 24 24",
    body: `<path d="M7 20.25H4.75C3.64543 20.25 2.75 19.3546 2.75 18.25V17.25C2.75 16.6977 3.19772 16.25 3.75 16.25H13.25C13.8023 16.25 14.25 16.6977 14.25 17.25V18.75C14.25 19.5784 14.9216 20.25 15.75 20.25C16.5784 20.25 17.25 19.5784 17.25 18.75V5.5C17.25 4.5335 18.0335 3.75 19 3.75C19.9665 3.75 20.75 4.5335 20.75 5.5V8C20.75 8.55228 20.3023 9 19.75 9H17.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 3.75H7.75C6.64543 3.75 5.75 4.64543 5.75 5.75V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 20.25H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 8.5H9.75L10.75 8L11.75 8.5H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 12H9.75L10.75 11.5L11.75 12H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
}

const spriteID = "bymorning-ui-icon-sprite"
const symbol = (name: keyof typeof icons) => `bymorning-ui-icon-${name}`
export const isIconName = (name: string): name is keyof typeof icons => Object.hasOwn(icons, name)
let spriteInserted = false

function ensureSprite() {
  if (spriteInserted) return
  if (typeof document === "undefined") return
  if (document.getElementById(spriteID)) {
    spriteInserted = true
    return
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  svg.innerHTML = Object.keys(icons)
    .filter(isIconName)
    .map((name) => `<symbol id="${symbol(name)}" viewBox="${icons[name].viewBox}">${icons[name].body}</symbol>`)
    .join("")
  document.body.insertBefore(svg, document.body.firstChild)
  spriteInserted = true
}

export interface IconProps extends ComponentProps<"svg"> {
  name: keyof typeof icons | (string & {})
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [split, rest] = splitProps(props, ["name", "size"])
  const iconName = () => (isIconName(split.name) ? split.name : "plus")
  const icon = () => icons[iconName()]
  const pixelSize = split.size === "small" ? 14 : split.size === "large" ? 20 : 16
  onMount(ensureSprite)

  return (
    <svg
      {...rest}
      data-slot="icon-svg"
      width={pixelSize}
      height={pixelSize}
      viewBox={icon().viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <use href={`#${symbol(iconName())}`} />
    </svg>
  )
}
